const pool = require('../config/database');
const billingService = require('../services/billingService');

/**
 * COMPREHENSIVE DATA CONSISTENCY CHECKER
 * 
 * Identifies mismatches between:
 * - Bills generated vs payments recorded
 * - Electricity readings vs calculated bills
 * - Payment amounts vs account status
 * - Outstanding balances across months
 */

/**
 * Check a single property for data consistency
 */
async function checkPropertyConsistency(propertyId) {
  const issues = [];
  const warnings = [];

  try {
    // 1. Verify property exists and has active tenant
    const propRes = await pool.query(
      'SELECT * FROM properties WHERE id = $1',
      [propertyId]
    );

    if (propRes.rows.length === 0) {
      return { success: false, error: 'Property not found' };
    }

    const property = propRes.rows[0];

    // 2. Check for active tenant
    const tenantRes = await pool.query(
      'SELECT * FROM tenants WHERE property_id = $1 AND status = $2',
      [propertyId, 'active']
    );

    if (tenantRes.rows.length === 0) {
      warnings.push('No active tenant for this property');
      return { success: true, property, issues, warnings };
    }

    const tenant = tenantRes.rows[0];

    // 3. Get all payments for this property
    const paymentsRes = await pool.query(
      'SELECT * FROM rent_payments WHERE property_id = $1 ORDER BY month_year ASC',
      [propertyId]
    );

    let runningBalance = 0;

    for (const payment of paymentsRes.rows) {
      // Check 1: Total due consistency
      const expectedDue = await billingService.calculateTotalDue(propertyId, payment.month_year);
      if (Math.abs(expectedDue.totalDue - payment.total_due) > 1) { // Allow ₹1 rounding difference
        issues.push({
          type: 'TOTAL_DUE_MISMATCH',
          month: payment.month_year,
          expected: expectedDue.totalDue,
          actual: payment.total_due,
          difference: expectedDue.totalDue - payment.total_due
        });
      }

      // Check 2: Base rent consistency
      const tenantRent = parseFloat(tenant.rent_amount || 0);
      const paymentBaseRent = parseFloat(payment.base_rent || 0);
      if (Math.abs(tenantRent - paymentBaseRent) > 0.01) {
        issues.push({
          type: 'BASE_RENT_MISMATCH',
          month: payment.month_year,
          expected: tenantRent,
          actual: paymentBaseRent
        });
      }

      // Check 3: Payment status consistency
      const amountPaid = parseFloat(payment.amount_paid) || 0;
      let expectedStatus = 'pending';
      if (amountPaid >= payment.total_due) {
        expectedStatus = 'paid';
      } else if (amountPaid > 0) {
        expectedStatus = 'partial';
      }

      if (payment.payment_status !== expectedStatus) {
        issues.push({
          type: 'PAYMENT_STATUS_MISMATCH',
          month: payment.month_year,
          expected: expectedStatus,
          actual: payment.payment_status,
          details: `Amount Paid: ₹${amountPaid}, Total Due: ₹${payment.total_due}`
        });
      }

      // Check 4: No negative balances
      const monthBalance = payment.total_due - amountPaid;
      if (monthBalance < 0) {
        issues.push({
          type: 'OVERPAYMENT_DETECTED',
          month: payment.month_year,
          overpaid_by: Math.abs(monthBalance),
          details: `Amount Paid: ₹${amountPaid}, Total Due: ₹${payment.total_due}`
        });
      }

      runningBalance += monthBalance;
    }

    // Check 5: Outstanding balance consistency
    const outstandingRes = await pool.query(
      `SELECT COALESCE(SUM(total_due - amount_paid), 0) as outstanding
       FROM rent_payments
       WHERE property_id = $1 AND (total_due - amount_paid) > 0`,
      [propertyId]
    );

    const calculatedOutstanding = parseFloat(outstandingRes.rows[0].outstanding) || 0;
    if (Math.abs(runningBalance - calculatedOutstanding) > 1) {
      warnings.push({
        type: 'OUTSTANDING_BALANCE_VARIANCE',
        calculated: runningBalance,
        from_query: calculatedOutstanding,
        variance: Math.abs(runningBalance - calculatedOutstanding)
      });
    }

    // Check 6: Electricity readings exist for billedmonths
    for (const payment of paymentsRes.rows) {
      const meterRes = await pool.query(
        `SELECT COUNT(*) as count FROM meter_readings
         WHERE property_id = $1 AND strftime('%Y-%m', reading_date) = $2`,
        [propertyId, payment.month_year]
      );

      const meterCount = parseInt(meterRes.rows[0]?.count || 0, 10);
      if (meterCount === 0 && parseFloat(payment.electricity_bill || 0) > 0) {
        warnings.push({
          type: 'MISSING_METER_READING',
          month: payment.month_year,
          billed_electricity: payment.electricity_bill,
          note: 'Bill includes electricity but no reading found for this month'
        });
      }
    }

    return {
      success: true,
      property,
      tenant,
      issues: issues.length > 0 ? issues : null,
      warnings: warnings.length > 0 ? warnings : null,
      summary: {
        total_payments_recorded: paymentsRes.rows.length,
        issues_found: issues.length,
        warnings_found: warnings.length,
        outstanding_balance: runningBalance
      }
    };

  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Check all properties for consistency
 */
async function checkAllPropertiesConsistency() {
  const results = [];
  const summary = {
    total_properties: 0,
    properties_with_issues: 0,
    properties_with_warnings: 0,
    total_issues_found: 0,
    total_warnings_found: 0
  };

  try {
    const propsRes = await pool.query(
      'SELECT id FROM properties WHERE is_occupied = 1 ORDER BY room_number'
    );

    summary.total_properties = propsRes.rows.length;

    for (const prop of propsRes.rows) {
      const check = await checkPropertyConsistency(prop.id);
      if (check.success) {
        results.push(check);
        
        if (check.issues) {
          summary.properties_with_issues++;
          summary.total_issues_found += check.issues.length;
        }
        
        if (check.warnings) {
          summary.properties_with_warnings++;
          summary.total_warnings_found += check.warnings.length;
        }
      }
    }

    return { success: true, results, summary };

  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Get detailed payment audit trail for a property
 */
async function getPaymentAuditTrail(propertyId) {
  try {
    const result = await pool.query(
      `SELECT 
        rp.id,
        rp.month_year,
        rp.base_rent,
        rp.electricity_bill,
        rp.total_due,
        rp.amount_paid,
        rp.payment_status,
        rp.payment_date,
        rp.notes,
        rp.created_at,
        rp.updated_at,
        COUNT(pc.id) as correction_count,
        GROUP_CONCAT(pc.old_amount || ' -> ' || pc.new_amount, '; ') as corrections
      FROM rent_payments rp
      LEFT JOIN payment_corrections pc ON rp.id = pc.payment_id
      WHERE rp.property_id = $1
      GROUP BY rp.id
      ORDER BY rp.month_year DESC`,
      [propertyId]
    );

    return { success: true, audit_trail: result.rows };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Find duplicate or suspicious payment patterns
 */
async function findSuspiciousPayments() {
  try {
    const duplicates = await pool.query(
      `SELECT 
        property_id, month_year, amount_paid, payment_date, COUNT(*) as count
      FROM rent_payments
      WHERE amount_paid > 0
      GROUP BY property_id, month_year
      HAVING count > 1`
    );

    const overpayments = await pool.query(
      `SELECT 
        property_id, month_year, total_due, amount_paid, 
        (amount_paid - total_due) as overpaid
      FROM rent_payments
      WHERE amount_paid > total_due
      ORDER BY overpaid DESC`
    );

    const zeroPayments = await pool.query(
      `SELECT 
        property_id, month_year, total_due, payment_status
      FROM rent_payments
      WHERE amount_paid = 0 AND payment_status != 'pending'`
    );

    return {
      success: true,
      duplicates: duplicates.rows,
      overpayments: overpayments.rows,
      zero_payments: zeroPayments.rows,
      summary: {
        duplicate_records: duplicates.rows.length,
        overpaid_records: overpayments.rows.length,
        inconsistent_status_records: zeroPayments.rows.length
      }
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Generate a detailed consistency report
 */
async function generateConsistencyReport() {
  const report = {
    timestamp: new Date().toISOString(),
    sections: {}
  };

  try {
    // Section 1: Overall system health
    report.sections.system_health = await checkAllPropertiesConsistency();

    // Section 2: Suspicious payments
    report.sections.suspicious_payments = await findSuspiciousPayments();

    // Section 3: Outstanding balance summary
    const outstandingRes = await pool.query(
      `SELECT 
        COUNT(DISTINCT property_id) as properties_with_outstanding,
        COUNT(*) as months_with_outstanding,
        SUM(total_due - amount_paid) as total_outstanding_amount
      FROM rent_payments
      WHERE (total_due - amount_paid) > 0`
    );
    report.sections.outstanding_summary = outstandingRes.rows[0];

    // Section 4: Payment corrections
    const correctionsRes = await pool.query(
      `SELECT 
        COUNT(*) as total_corrections,
        COUNT(DISTINCT payment_id) as payments_corrected,
        SUM(new_amount - old_amount) as total_adjustment
      FROM payment_corrections`
    );
    report.sections.corrections_summary = correctionsRes.rows[0];

    report.success = true;
  } catch (error) {
    report.success = false;
    report.error = error.message;
  }

  return report;
}

module.exports = {
  checkPropertyConsistency,
  checkAllPropertiesConsistency,
  getPaymentAuditTrail,
  findSuspiciousPayments,
  generateConsistencyReport
};
