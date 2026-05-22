const express = require('express');
const router = express.Router();
const pool = require('../config/database');

/**
 * GET - Main dashboard summary
 */
router.get('/', async (req, res) => {
  try {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const monthYear = `${year}-${month}`;

    // 1. Get total occupied properties
    const occupiedResult = await pool.query("SELECT COUNT(*) as count FROM properties WHERE is_occupied = 1 AND room_number != 'Common Meter'");
    const occupiedCount = parseInt(occupiedResult.rows[0]?.count || 0, 10);

    // 2. Get expected monthly income
    const incomeResult = await pool.query(`
      SELECT COALESCE(SUM(rent_amount), 0) as total_income
      FROM tenants t
      JOIN properties p ON t.property_id = p.id
      WHERE p.is_occupied = 1 AND t.status = 'active' AND p.room_number != 'Common Meter'
    `);
    const expectedIncome = parseFloat(incomeResult.rows[0]?.total_income || 0);

    // 3. Get manual electricity expenses + Common Meter consumption cost
    // We sum manual entries from maintenance_expenses AND calculated cost from Common Meter readings
    const electricityResult = await pool.query(`
      SELECT (
        SELECT COALESCE(SUM(amount), 0) FROM maintenance_expenses 
        WHERE month_year = $1 AND expense_type = 'common'
      ) + (
        SELECT COALESCE(SUM(units_consumed * 9), 0) 
        FROM meter_readings mr
        JOIN properties p ON mr.property_id = p.id
        WHERE p.room_number = 'Common Meter' 
        AND strftime('%Y-%m', mr.reading_date) = $1
      ) as total_electricity
    `, [monthYear]);
    const electricityExpense = parseFloat(electricityResult.rows[0]?.total_electricity || 0);

    // 4. Fixed sweeper expense
    const sweeperExpense = 2200;

    // 5. Net income
    const netIncome = expectedIncome - electricityExpense - sweeperExpense;

    // 6. Get actual collections for current month
    const collectionsResult = await pool.query(`
      SELECT COALESCE(SUM(amount_paid), 0) as total_paid
      FROM rent_payments
      WHERE month_year = $1
    `, [monthYear]);
    const actualCollections = parseFloat(collectionsResult.rows[0]?.total_paid || 0);

    // 7. Get pending rent count (Tenants who haven't paid fully)
    const pendingResult = await pool.query(`
      SELECT COUNT(*) as count 
      FROM properties p
      JOIN tenants t ON p.id = t.property_id AND t.status = 'active'
      LEFT JOIN rent_payments rp ON p.id = rp.property_id AND rp.month_year = $1
      WHERE p.is_occupied = 1 
      AND p.room_number != 'Common Meter'
      AND (rp.payment_status IN ('pending', 'partial') OR rp.payment_status IS NULL)
    `, [monthYear]);
    const pendingRentCount = parseInt(pendingResult.rows[0]?.count || 0, 10);

    // 8. Get vacant properties count
    const vacantResult = await pool.query("SELECT COUNT(*) as count FROM properties WHERE is_occupied = 0 AND room_number != 'Common Meter'");

    // 9. Get power-off properties count
    const powerOffResult = await pool.query("SELECT COUNT(*) as count FROM properties WHERE power_status = 0 AND is_occupied = 1 AND room_number != 'Common Meter'");
    const powerOffCount = parseInt(powerOffResult.rows[0]?.count || 0, 10);

    // 10. Get absolute total properties count
    const totalResult = await pool.query("SELECT COUNT(*) as count FROM properties WHERE room_number != 'Common Meter'");
    const totalProperties = parseInt(totalResult.rows[0]?.count || 0, 10);

    res.json({
      summary: {
        total_properties: totalProperties,
        occupied_count: occupiedCount,
        vacant_count: parseInt(vacantResult.rows[0]?.count || 0, 10),
        power_off_count: powerOffCount,
      },
      financial: {
        expected_monthly_income: expectedIncome,
        actual_collections: actualCollections,
        electricity_expense: electricityExpense,
        sweeper_expense: sweeperExpense,
        net_income: netIncome,
        collection_percentage: expectedIncome > 0 ? parseFloat(((actualCollections / expectedIncome) * 100).toFixed(2)) : 0,
      },
      pending: {
        rent_count: pendingRentCount,
      },
      month_year: monthYear,
    });
  } catch (error) {
    console.error('Error fetching dashboard:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET - Pending rent list
 */
router.get('/pending-rent', async (req, res) => {
  try {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const monthYear = `${year}-${month}`;

    // SQLite: strftime('%d', 'now') instead of EXTRACT(DAY FROM CURRENT_DATE)
    const result = await pool.query(`
      SELECT 
        p.id,
        p.room_number,
        p.property_type,
        t.name as tenant_name,
        t.phone,
        t.committed_payment_date,
        COALESCE(rp.total_due, t.rent_amount) as total_due,
        COALESCE(rp.amount_paid, 0) as amount_paid,
        (COALESCE(rp.total_due, t.rent_amount) - COALESCE(rp.amount_paid, 0)) as pending_amount,
        COALESCE(rp.payment_status, 'pending') as payment_status,
        CASE 
          WHEN CAST(strftime('%d', 'now') AS INTEGER) > t.committed_payment_date 
          THEN CAST(strftime('%d', 'now') AS INTEGER) - t.committed_payment_date
          ELSE 0
        END as days_overdue
      FROM properties p
      JOIN tenants t ON p.id = t.property_id AND t.status = 'active'
      LEFT JOIN rent_payments rp ON p.id = rp.property_id AND rp.month_year = $1
      WHERE p.is_occupied = 1 AND (rp.payment_status IN ('pending', 'partial') OR rp.payment_status IS NULL)
      ORDER BY days_overdue DESC, p.room_number
    `, [monthYear]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching pending rent:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET - Vacant properties list
 */
router.get('/vacant', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM properties WHERE is_occupied = 0 ORDER BY room_number
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching vacant properties:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET - Electricity summary
 */
router.get('/electricity-summary', async (req, res) => {
  try {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const monthYear = `${year}-${month}`;

    // SQLite: date($1) instead of $1::date
    const result = await pool.query(`
      SELECT 
        COUNT(DISTINCT property_id) as total_properties,
        COALESCE(SUM(units_consumed), 0) as total_units,
        COALESCE(SUM(units_consumed * 9), 0) as total_cost,
        COALESCE(AVG(units_consumed * 9), 0) as avg_cost_per_unit
      FROM meter_readings
      WHERE reading_date >= date($1 || '-01') 
        AND reading_date < date($1 || '-01', '+1 month')
    `, [monthYear]);

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching electricity summary:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET - Monthly report
 */
router.get('/monthly-report', async (req, res) => {
  try {
    const { month_year } = req.query;
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const localMonthYear = `${year}-${month}`;
    const reportMonth = month_year || localMonthYear;

    const result = await pool.query(`
      SELECT 
        'Income' as category,
        'Expected Rent' as item,
        COALESCE(SUM(rent_amount), 0) as amount
      FROM tenants t
      JOIN properties p ON t.property_id = p.id
      WHERE p.is_occupied = 1 AND t.status = 'active'
      
      UNION ALL
      
      SELECT 
        'Income' as category,
        'Actual Collections' as item,
        COALESCE(SUM(amount_paid), 0) as amount
      FROM rent_payments rp
      JOIN properties p ON rp.property_id = p.id
      WHERE rp.month_year = $1
      
      UNION ALL
      
      SELECT 
        'Expenses' as category,
        'Electricity (Manual + Common Meter)' as item,
        (
          SELECT COALESCE(SUM(amount), 0) FROM maintenance_expenses 
          WHERE month_year = $1 AND expense_type = 'common'
        ) + (
          SELECT COALESCE(SUM(units_consumed * 9), 0) 
          FROM meter_readings mr
          JOIN properties p ON mr.property_id = p.id
          WHERE p.room_number = 'Common Meter' 
          AND strftime('%Y-%m', mr.reading_date) = $1
        ) as amount
      
      UNION ALL
      
      SELECT 
        'Expenses' as category,
        'Sweeper' as item,
        2200 as amount
    `, [reportMonth]);

    res.json({
      month_year: reportMonth,
      items: result.rows,
    });
  } catch (error) {
    console.error('Error generating monthly report:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET - Historical collection stats for charts
 */
router.get('/stats/collections', async (req, res) => {
  try {
    const now = new Date();
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }

    const expectedRes = await pool.query(`
      SELECT COALESCE(SUM(t.rent_amount), 0) as total_expected
      FROM tenants t
      JOIN properties p ON t.property_id = p.id
      WHERE p.is_occupied = 1 AND t.status = 'active' AND p.room_number != 'Common Meter'
    `);
    const expectedTotal = expectedRes.rows[0]?.total_expected || 0;

    const stats = [];
    for (const monthYear of months) {
      const actualRes = await pool.query(`
        SELECT COALESCE(SUM(amount_paid), 0) as total_actual
        FROM rent_payments rp
        JOIN properties p ON rp.property_id = p.id
        WHERE rp.month_year = $1 AND p.room_number != 'Common Meter'
      `, [monthYear]);

      stats.push({
        month: monthYear,
        expected: expectedTotal,
        actual: actualRes.rows[0]?.total_actual || 0,
      });
    }

    res.json(stats);
  } catch (error) {
    console.error('Error fetching collection stats:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET - Detailed electricity consumption report
 */
router.get('/electricity-report', async (req, res) => {
  try {
    const { month_year } = req.query;
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const localMonthYear = `${year}-${month}`;
    const reportMonth = month_year || localMonthYear;

    const result = await pool.query(`
      SELECT 
        p.room_number,
        p.meter_number,
        t.name as tenant_name,
        mr.previous_reading,
        mr.current_reading,
        mr.units_consumed,
        (mr.units_consumed * 9) as cost,
        mr.reading_date
      FROM properties p
      LEFT JOIN tenants t ON p.id = t.property_id AND t.status = 'active'
      LEFT JOIN meter_readings mr ON p.id = mr.property_id 
        AND strftime('%Y-%m', mr.reading_date) = $1
      WHERE p.room_number != 'Common Meter' OR mr.id IS NOT NULL
      ORDER BY p.room_number
    `, [reportMonth]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching electricity report:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
