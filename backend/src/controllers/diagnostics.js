const express = require('express');
const router = express.Router();
const dataConsistencyChecker = require('../utils/dataConsistencyChecker');
const pool = require('../config/database');

/**
 * GET - Full system data consistency report
 * Admin endpoint to diagnose payment and billing mismatches
 */
router.get('/consistency-report', async (req, res) => {
  try {
    const report = await dataConsistencyChecker.generateConsistencyReport();
    res.json(report);
  } catch (error) {
    console.error('Error generating consistency report:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET - Check single property consistency
 */
router.get('/consistency-check/:property_id', async (req, res) => {
  try {
    const { property_id } = req.params;
    const check = await dataConsistencyChecker.checkPropertyConsistency(parseInt(property_id));
    res.json(check);
  } catch (error) {
    console.error('Error checking property consistency:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET - All properties consistency check
 */
router.get('/consistency-check-all', async (req, res) => {
  try {
    const checks = await dataConsistencyChecker.checkAllPropertiesConsistency();
    res.json(checks);
  } catch (error) {
    console.error('Error checking all properties consistency:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET - Payment audit trail for a property
 */
router.get('/audit-trail/:property_id', async (req, res) => {
  try {
    const { property_id } = req.params;
    const trail = await dataConsistencyChecker.getPaymentAuditTrail(parseInt(property_id));
    res.json(trail);
  } catch (error) {
    console.error('Error fetching audit trail:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET - Find suspicious payments
 */
router.get('/suspicious-payments', async (req, res) => {
  try {
    const suspicious = await dataConsistencyChecker.findSuspiciousPayments();
    res.json(suspicious);
  } catch (error) {
    console.error('Error finding suspicious payments:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST - Regenerate bills for a month (Recovery utility)
 * Use this to fix electricity bills that were calculated with wrong readings
 */
router.post('/regenerate-bills/:month_year', async (req, res) => {
  try {
    const { month_year } = req.params;
    const billingService = require('../services/billingService');

    // Validate month format
    if (!/^\d{4}-\d{2}$/.test(month_year)) {
      return res.status(400).json({ 
        error: 'Invalid month format. Use YYYY-MM (e.g., 2026-04)' 
      });
    }

    const result = await billingService.generateAllBills(month_year);
    
    if (result.success) {
      res.json({
        success: true,
        message: `Bills regenerated for ${month_year}`,
        processed: result.processed
      });
    } else {
      res.status(500).json({
        error: 'Failed to regenerate bills',
        details: result.error
      });
    }
  } catch (error) {
    console.error('Error regenerating bills:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST - Fix payment corrections for a property
 * 
 * Use this when a tenant has overpaid or been charged incorrectly
 * This creates an audit trail entry and adjusts the amount_paid
 */
router.post('/fix-payment/:payment_id', async (req, res) => {
  try {
    const { payment_id } = req.params;
    const { amount_paid, reason } = req.body;

    if (amount_paid === undefined || typeof amount_paid !== 'number' || amount_paid < 0) {
      return res.status(400).json({
        error: 'Invalid amount_paid. Must be a non-negative number.'
      });
    }

    // Get current payment
    const paymentRes = await pool.query(
      'SELECT * FROM rent_payments WHERE id = $1',
      [parseInt(payment_id)]
    );

    if (paymentRes.rows.length === 0) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    const payment = paymentRes.rows[0];

    // Log the correction
    await pool.query(
      `INSERT INTO payment_corrections (payment_id, old_amount, new_amount, reason, corrected_at)
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
      [parseInt(payment_id), payment.amount_paid, amount_paid, reason || 'Admin correction']
    );

    // Update the payment
    let status = 'pending';
    if (amount_paid >= payment.total_due) {
      status = 'paid';
    } else if (amount_paid > 0) {
      status = 'partial';
    }

    await pool.query(
      `UPDATE rent_payments
       SET amount_paid = $1, payment_status = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [amount_paid, status, parseInt(payment_id)]
    );

    // Get updated payment
    const updatedRes = await pool.query(
      'SELECT * FROM rent_payments WHERE id = $1',
      [parseInt(payment_id)]
    );

    res.json({
      success: true,
      message: `Payment corrected from ₹${payment.amount_paid} to ₹${amount_paid}`,
      old_payment: payment,
      new_payment: updatedRes.rows[0]
    });

  } catch (error) {
    console.error('Error fixing payment:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET - Outstanding balance by property
 */
router.get('/outstanding-balance', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        p.id,
        p.room_number,
        t.name as tenant_name,
        SUM(rp.total_due - rp.amount_paid) as total_outstanding,
        COUNT(rp.id) as unpaid_months,
        MAX(rp.month_year) as most_recent_month
      FROM properties p
      JOIN tenants t ON p.id = t.property_id
      LEFT JOIN rent_payments rp ON p.id = rp.property_id AND (rp.total_due - rp.amount_paid) > 0
      WHERE p.is_occupied = 1 AND t.status = 'active'
      GROUP BY p.id, p.room_number, t.name
      HAVING total_outstanding > 0
      ORDER BY total_outstanding DESC
    `);

    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows,
      total_outstanding: result.rows.reduce((sum, row) => sum + (parseFloat(row.total_outstanding) || 0), 0)
    });
  } catch (error) {
    console.error('Error fetching outstanding balance:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET - Payment collection summary
 */
router.get('/collection-summary', async (req, res) => {
  try {
    const monthYear = req.query.month_year || new Date().toISOString().slice(0, 7);

    const result = await pool.query(`
      SELECT 
        COUNT(DISTINCT p.id) as total_properties,
        COUNT(CASE WHEN rp.payment_status = 'paid' THEN 1 END) as paid_count,
        COUNT(CASE WHEN rp.payment_status = 'partial' THEN 1 END) as partial_count,
        COUNT(CASE WHEN rp.payment_status = 'pending' THEN 1 END) as pending_count,
        SUM(CASE WHEN rp.payment_status = 'paid' THEN rp.total_due ELSE 0 END) as total_collected,
        SUM(rp.total_due) as total_expected,
        SUM(rp.amount_paid) as total_paid,
        SUM(rp.total_due - rp.amount_paid) as total_outstanding
      FROM properties p
      JOIN tenants t ON p.id = t.property_id
      LEFT JOIN rent_payments rp ON p.id = rp.property_id AND rp.month_year = $1
      WHERE p.is_occupied = 1 AND t.status = 'active'
    `, [monthYear]);

    const summary = result.rows[0];
    const collectionPercent = summary.total_expected > 0 
      ? ((summary.total_paid / summary.total_expected) * 100).toFixed(2)
      : 0;

    res.json({
      success: true,
      month_year: monthYear,
      summary: {
        ...summary,
        collection_percentage: parseFloat(collectionPercent)
      }
    });
  } catch (error) {
    console.error('Error fetching collection summary:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
