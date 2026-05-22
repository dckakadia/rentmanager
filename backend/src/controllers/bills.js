const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { recalcBalances } = require('../utils/ledgerSync');

/**
 * Helper: Get month name from YYYY-MM format
 */
function getMonthName(monthYearStr) {
  const [year, month] = monthYearStr.split('-');
  const date = new Date(parseInt(year), parseInt(month) - 1, 1);
  return date.toLocaleString('en-IN', { month: 'long' });
}

/**
 * Helper: Calculate month-year from a date (billing cycle: 11th to 10th)
 * If date is 11th onwards, it belongs to current month
 * If date is 1st-10th, it belongs to previous month
 */
function getBillingMonthYear(date) {
  const d = new Date(date);
  const day = d.getDate();
  const month = d.getMonth();
  const year = d.getFullYear();

  if (day < 11) {
    // 1st-10th belongs to previous month
    if (month === 0) {
      return `${year - 1}-12`;
    } else {
      return `${year}-${String(month).padStart(2, '0')}`;
    }
  } else {
    // 11th-31st belongs to current month
    return `${year}-${String(month + 1).padStart(2, '0')}`;
  }
}

/**
 * GET /api/bills/billing-summary
 * Fetch occupied tenants with rent amounts and latest meter readings
 * Query params: period_from (YYYY-MM-DD), period_to (YYYY-MM-DD)
 */
router.get('/billing-summary', async (req, res) => {
  try {
    const { period_from, period_to, month_year } = req.query;
    
    if (!period_from || !period_to) {
      return res.status(400).json({
        error: 'period_from and period_to are required (YYYY-MM-DD format)'
      });
    }

    const billingMonth = month_year || getBillingMonthYear(period_from);

    // Get all occupied tenants with their rent amounts
    const tenantsRes = await pool.query(`
      SELECT 
        t.id as tenant_id,
        t.name as tenant_name,
        t.rent_amount,
        p.id as property_id,
        p.room_number,
        p.property_type
      FROM tenants t
      JOIN properties p ON t.property_id = p.id
      WHERE p.is_occupied = 1 AND t.status = 'active'
      ORDER BY p.room_number ASC
    `);

    const tenants = tenantsRes.rows;

    // Check existing bills for this month
    const billedRes = await pool.query(`
      SELECT tenant_id, charge_type
      FROM transactions
      WHERE type = 'debit' AND month_year = ? AND charge_type IN ('rent', 'electricity')
    `, [billingMonth]);

    const billedMap = {};
    billedRes.rows.forEach(row => {
      if (!billedMap[row.tenant_id]) billedMap[row.tenant_id] = {};
      billedMap[row.tenant_id][row.charge_type] = true;
    });

    // For each tenant, get the latest meter reading
    const tenantsWithReadings = await Promise.all(
      tenants.map(async (tenant) => {
        const readingRes = await pool.query(`
          SELECT 
            current_reading,
            previous_reading,
            units_consumed,
            reading_date
          FROM meter_readings
          WHERE property_id = $1
          ORDER BY reading_date DESC
          LIMIT 1
        `, [tenant.property_id]);

        const latestReading = readingRes.rows.length > 0 ? readingRes.rows[0] : null;

        return {
          ...tenant,
          has_rent_bill: !!billedMap[tenant.tenant_id]?.rent,
          has_electricity_bill: !!billedMap[tenant.tenant_id]?.electricity,
          latest_meter_reading: latestReading ? {
            current_reading: latestReading.current_reading,
            previous_reading: latestReading.previous_reading,
            units_consumed: latestReading.units_consumed,
            reading_date: latestReading.reading_date
          } : null
        };
      })
    );

    // Get electricity rate (hardcoded as per existing system: ₹9 per unit)
    const electricityRate = 9;

    res.json({
      tenants: tenantsWithReadings,
      electricity_rate: electricityRate,
      period_from,
      period_to
    });

  } catch (error) {
    console.error('Error fetching billing summary:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/bills/check-duplicate
 * Check if bills already exist for a given billing period
 * Body: { period_from, period_to, tenant_ids: [1, 2, 3] }
 */
router.post('/check-duplicate', async (req, res) => {
  try {
    const { period_from, period_to, tenant_ids, month_year } = req.body;

    if (!period_from || !period_to || !tenant_ids || !Array.isArray(tenant_ids)) {
      return res.status(400).json({
        error: 'period_from, period_to, and tenant_ids array are required'
      });
    }

    // Get billing month from period_from (use the start date's billing month)
    const billingMonth = month_year || getBillingMonthYear(period_from);
    const monthName = getMonthName(billingMonth);

    // Check for existing Rent bills
    const rentRes = await pool.query(`
      SELECT tenant_id, COUNT(*) as count
      FROM transactions
      WHERE tenant_id IN (${tenant_ids.map(() => '?').join(',')})
        AND type = 'debit'
        AND charge_type = 'rent'
        AND month_year = ?
      GROUP BY tenant_id
    `, [...tenant_ids, billingMonth]);

    // Check for existing Electricity bills
    const elecRes = await pool.query(`
      SELECT tenant_id, COUNT(*) as count
      FROM transactions
      WHERE tenant_id IN (${tenant_ids.map(() => '?').join(',')})
        AND type = 'debit'
        AND charge_type = 'electricity'
        AND month_year = ?
      GROUP BY tenant_id
    `, [...tenant_ids, billingMonth]);

    const duplicateRent = rentRes.rows.reduce((acc, r) => {
      if (r.count > 0) acc.push(r.tenant_id);
      return acc;
    }, []);

    const duplicateElec = elecRes.rows.reduce((acc, r) => {
      if (r.count > 0) acc.push(r.tenant_id);
      return acc;
    }, []);

    const hasDuplicates = duplicateRent.length > 0 || duplicateElec.length > 0;

    res.json({
      has_duplicates: hasDuplicates,
      duplicate_rent_tenants: duplicateRent,
      duplicate_electricity_tenants: duplicateElec,
      billing_month: billingMonth,
      month_name: monthName
    });

  } catch (error) {
    console.error('Error checking duplicates:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/bills/generate
 * Generate bills and create ledger entries
 * Body: {
 *   period_from, period_to,
 *   rent_bills: [{ tenant_id, amount, include: true }],
 *   electricity_bills: [{ tenant_id, amount, include: true }]
 * }
 */
router.post('/generate', async (req, res) => {
  try {
    const { period_from, period_to, rent_label, electricity_label, rent_bills, electricity_bills, month_year } = req.body;

    if (!period_from || !period_to) {
      return res.status(400).json({ error: 'period_from and period_to are required' });
    }

    if (!Array.isArray(rent_bills) || !Array.isArray(electricity_bills)) {
      return res.status(400).json({ error: 'rent_bills and electricity_bills must be arrays' });
    }

    // Start transaction
    await pool.query('BEGIN TRANSACTION');

    try {
      const billingMonth = month_year || getBillingMonthYear(period_from);
      const monthName = getMonthName(billingMonth);
      const todayDate = new Date().toISOString().split('T')[0];
      const rentLabel = rent_label || `${monthName}-Rent`;
      const electricityLabel = electricity_label || `${monthName}-Electricity Bills`;
      const noteTable = [
        '| Period Start | Period End | Rent Ledger Label | Electricity Ledger Label |',
        '|---|---|---|---|',
        `| ${period_from} | ${period_to} | ${rentLabel} | ${electricityLabel} |`
      ].join('\n');

      const createdEntries = [];
      const errors = [];

      // Process rent bills
      for (const bill of rent_bills) {
        if (!bill.include) continue;

        const { tenant_id, amount } = bill;
        const rentAmount = parseFloat(amount) || 0;

        try {
          // Get property_id from tenant
          const tenantRes = await pool.query(
            'SELECT property_id FROM tenants WHERE id = ?',
            [tenant_id]
          );
          
          if (tenantRes.rows.length === 0) {
            errors.push({ tenant_id, type: 'rent', error: 'Tenant not found' });
            continue;
          }

          const property_id = tenantRes.rows[0].property_id;

          // Create rent debit entry
          const rentRes = await pool.query(`
            INSERT INTO transactions (
              tenant_id, property_id, date, type, charge_type, 
              particulars, debit, credit, running_balance, month_year, notes
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, [
            tenant_id,
            property_id,
            todayDate,
            'debit',
            'rent',
            rentLabel,
            rentAmount,
            0,
            0, // Will be recalculated
            billingMonth,
            noteTable
          ]);

          createdEntries.push({
            tenant_id,
            type: 'rent',
            amount: rentAmount,
            particulars: rentLabel
          });

        } catch (err) {
          errors.push({ tenant_id, type: 'rent', error: err.message });
        }
      }

      // Process electricity bills
      for (const bill of electricity_bills) {
        if (!bill.include) continue;

        const { tenant_id, amount } = bill;
        const elecAmount = parseFloat(amount) || 0;

        try {
          // Get property_id from tenant
          const tenantRes = await pool.query(
            'SELECT property_id FROM tenants WHERE id = ?',
            [tenant_id]
          );
          
          if (tenantRes.rows.length === 0) {
            errors.push({ tenant_id, type: 'electricity', error: 'Tenant not found' });
            continue;
          }

          const property_id = tenantRes.rows[0].property_id;

          // Create electricity debit entry
          const elecRes = await pool.query(`
            INSERT INTO transactions (
              tenant_id, property_id, date, type, charge_type,
              particulars, debit, credit, running_balance, month_year, notes
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, [
            tenant_id,
            property_id,
            todayDate,
            'debit',
            'electricity',
            electricityLabel,
            elecAmount,
            0,
            0, // Will be recalculated
            billingMonth,
            noteTable
          ]);

          createdEntries.push({
            tenant_id,
            type: 'electricity',
            amount: elecAmount,
            particulars: electricityLabel
          });

        } catch (err) {
          errors.push({ tenant_id, type: 'electricity', error: err.message });
        }
      }

      // Recalculate balances for all affected tenants
      const affectedTenants = new Set();
      createdEntries.forEach(entry => affectedTenants.add(entry.tenant_id));

      for (const tenantId of affectedTenants) {
        await recalcBalances(tenantId);
      }

      await pool.query('COMMIT');

      console.log(`[BILLS] Generated ${createdEntries.length} entries for billing month ${billingMonth}.`);
      if (errors.length > 0) {
        console.warn(`[BILLS] Bill generation completed with ${errors.length} error(s).`, errors);
      }

      res.json({
        success: true,
        created_entries: createdEntries,
        billing_month: billingMonth,
        month_name: monthName,
        total_entries: createdEntries.length,
        errors: errors.length > 0 ? errors : undefined
      });

    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }

  } catch (error) {
    console.error('Error generating bills:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
