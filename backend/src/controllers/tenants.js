const express = require('express');
const router = express.Router();
const pool = require('../config/database');

/**
 * GET - List all tenants
 */
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT t.*, p.property_type, p.room_number
      FROM tenants t
      JOIN properties p ON t.property_id = p.id
      ORDER BY p.room_number
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching tenants:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET - Get single tenant
 */
router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) return res.status(400).json({ error: 'Invalid tenant id' });
    const result = await pool.query(`
      SELECT t.*, p.property_type, p.room_number
      FROM tenants t
      JOIN properties p ON t.property_id = p.id
      WHERE t.id = $1
    `, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Tenant not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching tenant:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST - Create new tenant
 */
router.post('/', async (req, res) => {
  try {
    const {
      property_id,
      name,
      phone,
      rent_amount,
      deposit_amount,
      deposit_date,
      rental_start_date,
      committed_payment_date = 1,
      skip_auto_cutoff = 0,
    } = req.body;

    if (!property_id || !name || !phone || !rent_amount || !rental_start_date) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const insertRes = await pool.query(
      `INSERT INTO tenants 
       (property_id, name, phone, rent_amount, deposit_amount, deposit_date, rental_start_date, committed_payment_date, skip_auto_cutoff)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [property_id, name, phone, rent_amount, deposit_amount, deposit_date, rental_start_date, committed_payment_date, skip_auto_cutoff]
    );

    // Update property as occupied
    await pool.query('UPDATE properties SET is_occupied = 1 WHERE id = $1', [property_id]);

    const selectRes = await pool.query('SELECT * FROM tenants WHERE id = $1', [insertRes.lastID]);
    res.status(201).json(selectRes.rows[0]);
  } catch (error) {
    console.error('Error creating tenant:', error);
    // BUG#9 FIX: Better error handling for property constraint
    if (error.message.includes('UNIQUE constraint failed: tenants.property_id')) {
      return res.status(400).json({ 
        error: 'Property already has a tenant',
        message: 'This property is already rented. Please deactivate the existing tenant first.'
      });
    }
    res.status(500).json({ error: error.message });
  }
});

/**
 * PATCH - Update tenant details
 */
router.patch('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) return res.status(400).json({ error: 'Invalid tenant id' });
    const { name, phone, rent_amount, committed_payment_date, status, skip_auto_cutoff } = req.body;

    await pool.query(
      `UPDATE tenants 
       SET name = COALESCE($1, name),
           phone = COALESCE($2, phone),
           rent_amount = COALESCE($3, rent_amount),
           committed_payment_date = COALESCE($4, committed_payment_date),
           status = COALESCE($5, status),
           skip_auto_cutoff = COALESCE($6, skip_auto_cutoff),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $7`,
      [name, phone, rent_amount, committed_payment_date, status, skip_auto_cutoff, id]
    );

    const selectRes = await pool.query('SELECT * FROM tenants WHERE id = $1', [id]);
    if (selectRes.rows.length === 0) {
      return res.status(404).json({ error: 'Tenant not found' });
    }
    res.json(selectRes.rows[0]);
  } catch (error) {
    console.error('Error updating tenant:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE - Remove tenant (inactivate)
 */
router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) return res.status(400).json({ error: 'Invalid tenant id' });
    
    // 1. Verify tenant exists
    const selectRes = await pool.query('SELECT * FROM tenants WHERE id = $1', [id]);
    if (selectRes.rows.length === 0) {
      return res.status(404).json({ error: 'Tenant not found' });
    }
    const tenant = selectRes.rows[0];

    // 2. Check if tenant has linked transactions (in either rent_payments or transactions)
    const paymentCheck = await pool.query(
      'SELECT COUNT(*) as count FROM rent_payments WHERE property_id = $1 AND month_year >= substr($2, 1, 7)',
      [tenant.property_id, tenant.rental_start_date]
    );

    const txCheck = await pool.query(
      'SELECT COUNT(*) as count FROM transactions WHERE tenant_id = $1',
      [id]
    );

    const paymentCount = parseInt(paymentCheck.rows[0]?.count || 0, 10);
    const txCount = parseInt(txCheck.rows[0]?.count || 0, 10);
    if (paymentCount > 0 || txCount > 0) {
      return res.status(400).json({ error: 'Cannot delete tenant: Financial transactions are already linked to this tenant.' });
    }
    
    await pool.query(
      'UPDATE tenants SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      ['inactive', id]
    );

    // Check if any active tenants for this property
    const activeCheck = await pool.query(
      'SELECT COUNT(*) as count FROM tenants WHERE property_id = $1 AND status = $2',
      [tenant.property_id, 'active']
    );

    const activeCount = parseInt(activeCheck.rows[0]?.count || 0, 10);
    if (activeCount === 0) {
      await pool.query('UPDATE properties SET is_occupied = 0 WHERE id = $1', [tenant.property_id]);
    }

    res.json({ message: 'Tenant inactivated', data: tenant });
  } catch (error) {
    console.error('Error deleting tenant:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET - Tenant Ledger (Detailed history)
 */
router.get('/:id/ledger', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) return res.status(400).json({ error: 'Invalid tenant id' });
    
    // 1. Get tenant info
    const tenantRes = await pool.query(
      'SELECT id, property_id, name, rental_start_date, rent_amount FROM tenants WHERE id = $1',
      [id]
    );
    
    if (tenantRes.rows.length === 0) {
      return res.status(404).json({ error: 'Tenant not found' });
    }
    const tenant = tenantRes.rows[0];

    // 2. Get all transactions for this tenant
    const txRes = await pool.query(
      `SELECT * FROM transactions 
       WHERE tenant_id = $1 
       ORDER BY date ASC, id ASC`,
      [id]
    );

    // 3. Build ledger from transactions
    const ledger = txRes.rows.map(tx => ({
      id: tx.id,
      month_year: tx.month_year,
      rent_due: tx.charge_type === 'rent' ? tx.debit : 0,
      elec_due: tx.charge_type === 'electricity' ? tx.debit : 0,
      total_due: tx.debit,
      paid: tx.credit,
      balance: tx.running_balance,
      status: tx.type === 'credit' ? 'paid' : (tx.type === 'opening' ? 'opening' : 'pending'),
      date: tx.date,
      notes: tx.notes,
      particulars: tx.particulars,
      charge_type: tx.charge_type
    }));

    const lastBalance = txRes.rows.length > 0 ? txRes.rows[txRes.rows.length - 1].running_balance : 0;

    res.json({
      tenant,
      ledger: ledger.reverse(), // Newest first
      total_outstanding: lastBalance
    });
  } catch (error) {
    console.error('Error fetching tenant ledger:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
