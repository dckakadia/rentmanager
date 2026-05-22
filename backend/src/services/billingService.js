const pool = require('../config/database');

/**
 * FIXED: Calculate electricity bill for a given month
 * 
 * Logic:
 * - For month "2026-04", we want the reading TAKEN on 10th of April (which covers Mar 10 - Apr 10)
 * - This reading is recorded in meter_readings table with reading_date = "2026-04-10"
 * - We calculate: units_consumed * ₹9/unit
 * 
 * Fallback: If no exact 10th reading, use latest reading in that month
 */
async function calculateElectricityBill(propertyId, monthYear) {
  try {
    const [year, month] = monthYear.split('-').map(Number);
    const targetReadingDate = `${year}-${String(month).padStart(2, '0')}-10`;

    // Try exact 10th
    let result = await pool.query(
      `SELECT units_consumed, previous_reading
       FROM meter_readings 
       WHERE property_id = $1 AND reading_date = $2`,
      [propertyId, targetReadingDate]
    );

    if (result.rows.length > 0) {
      const row = result.rows[0];
      // BUGFIX: If previous_reading = 0 this is an opening/initialization reading.
      // The full meter value is NOT monthly consumption — bill is ₹0 for that period.
      if (parseFloat(row.previous_reading) === 0) {
        console.log(`[Billing] Opening reading detected for property ${propertyId} on ${targetReadingDate}. Billing ₹0.`);
        return 0;
      }
      const units = parseFloat(row.units_consumed) || 0;
      if (units > 0) return units * 9; // ₹9 per unit
    }

    // Fallback: Latest reading in the month (also check for opening reading)
    result = await pool.query(
      `SELECT units_consumed, previous_reading
       FROM meter_readings 
       WHERE property_id = $1 
       AND strftime('%Y-%m', reading_date) = $2
       ORDER BY reading_date DESC LIMIT 1`,
      [propertyId, monthYear]
    );

    if (result.rows.length > 0) {
      const row = result.rows[0];
      // Skip opening readings in fallback too
      if (parseFloat(row.previous_reading) === 0) return 0;
      const units = parseFloat(row.units_consumed) || 0;
      if (units > 0) return units * 9;
    }

    return 0; // No reading found
  } catch (error) {
    console.error(`[Billing] Error calculating electricity for property ${propertyId} month ${monthYear}:`, error);
    return 0;
  }
}

/**
 * FIXED: Calculate total due for a bill (centralized logic)
 */
async function calculateTotalDue(propertyId, monthYear) {
  try {
    // Get base rent from active tenant
    const tenantResult = await pool.query(
      'SELECT rent_amount FROM tenants WHERE property_id = $1 AND status = $2',
      [propertyId, 'active']
    );

    if (tenantResult.rows.length === 0) {
      return { baseRent: 0, electricityBill: 0, totalDue: 0 };
    }

    const baseRent = parseFloat(tenantResult.rows[0].rent_amount) || 0;
    const electricityBill = await calculateElectricityBill(propertyId, monthYear);

    return {
      baseRent,
      electricityBill,
      totalDue: baseRent + electricityBill
    };
  } catch (error) {
    console.error(`[Billing] Error calculating total due:`, error);
    return { baseRent: 0, electricityBill: 0, totalDue: 0 };
  }
}

/**
 * FIXED: Generate or update a bill for a property and month
 * 
 * This function:
 * 1. Gets base rent from active tenant
 * 2. Gets electricity bill for the month
 * 3. Creates or updates billing record
 * 4. Does NOT modify amount_paid (preserves payment data)
 * 5. Recalculates payment_status based on new total_due
 */
async function generateOrUpdateBill(propertyId, monthYear) {
  try {
    console.log(`[Billing] Generating bill for property ${propertyId} for ${monthYear}...`);

    // 1. Get tenant and calculate amounts
    const tenantResult = await pool.query(
      'SELECT id, rent_amount FROM tenants WHERE property_id = $1 AND status = $2',
      [propertyId, 'active']
    );

    if (tenantResult.rows.length === 0) {
      console.log(`[Billing] No active tenant found for property ${propertyId}. Skipping bill.`);
      return { success: false, reason: 'No active tenant' };
    }

    const baseRent = parseFloat(tenantResult.rows[0].rent_amount) || 0;
    const electricityBill = await calculateElectricityBill(propertyId, monthYear);
    const totalDue = baseRent + electricityBill;

    // 2. Get existing payment record (if any)
    const paymentResult = await pool.query(
      'SELECT id, amount_paid, payment_status FROM rent_payments WHERE property_id = $1 AND month_year = $2',
      [propertyId, monthYear]
    );

    // 3. Insert or update
    if (paymentResult.rows.length === 0) {
      // New bill - create with pending status
      await pool.query(
        `INSERT INTO rent_payments 
         (property_id, month_year, base_rent, electricity_bill, total_due, amount_paid, payment_status)
         VALUES ($1, $2, $3, $4, $5, 0, 'pending')`,
        [propertyId, monthYear, baseRent, electricityBill, totalDue]
      );
      console.log(`[Billing] New bill created for ${monthYear}: ₹${totalDue}`);
    } else {
      // Update existing - recalculate status based on new total_due
      const amountPaid = parseFloat(paymentResult.rows[0].amount_paid) || 0;
      let status = 'pending';
      if (amountPaid >= totalDue) status = 'paid';
      else if (amountPaid > 0) status = 'partial';

      await pool.query(
        `UPDATE rent_payments 
         SET base_rent = $1, 
             electricity_bill = $2, 
             total_due = $3, 
             payment_status = $4, 
             updated_at = CURRENT_TIMESTAMP
         WHERE property_id = $5 AND month_year = $6`,
        [baseRent, electricityBill, totalDue, status, propertyId, monthYear]
      );
      console.log(`[Billing] Bill updated for ${monthYear}: ₹${totalDue} (Paid: ₹${amountPaid})`);
    }

    // Synchronize to the transaction ledger automatically
    try {
      const { syncBillToTransactions } = require('../utils/ledgerSync');
      await syncBillToTransactions(propertyId, monthYear, baseRent, electricityBill);
    } catch (syncError) {
      console.error(`[Billing] Warning: Failed to sync bill to transactions:`, syncError.message);
    }

    return { success: true, baseRent, electricityBill, totalDue };
  } catch (error) {
    console.error(`[Billing Error] Failed to generate bill for property ${propertyId}:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * Utility to get the previous month in YYYY-MM format
 */
function getPreviousMonthYear() {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * Generate bills for ALL active properties for a specific month
 */
async function generateAllBills(monthYear) {
  try {
    const properties = await pool.query('SELECT id FROM properties WHERE is_occupied = 1');
    console.log(`[Billing] Batch generating bills for ${properties.rows.length} properties for ${monthYear}...`);
    
    for (const prop of properties.rows) {
      await generateOrUpdateBill(prop.id, monthYear);
    }
    return { success: true, processed: properties.rows.length };
  } catch (error) {
    console.error('[Billing Error] Batch generation failed:', error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  calculateElectricityBill,
  calculateTotalDue,
  generateOrUpdateBill,
  getPreviousMonthYear,
  generateAllBills
};
