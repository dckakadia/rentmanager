const express = require('express');
const router = express.Router();
const pool = require('../config/database');

const { recalcBalances, syncTransactionsToRentPayments, formatBillingMonthLabel } = require('../utils/ledgerSync');

/**
 * GET /api/transactions?tenant_id=X
 * Returns the full ledger for a tenant (oldest first)
 */
router.get('/', async (req, res) => {
  try {
    const tenant_id = parseInt(req.query.tenant_id, 10);
    if (isNaN(tenant_id) || tenant_id <= 0) return res.status(400).json({ error: 'tenant_id is required and must be a positive integer' });

    const tenantRes = await pool.query(
      `SELECT t.id, t.name, t.property_id, t.rental_start_date, t.rent_amount,
              p.room_number, p.property_type
       FROM tenants t JOIN properties p ON t.property_id = p.id
       WHERE t.id = $1`,
      [tenant_id]
    );
    if (tenantRes.rows.length === 0) return res.status(404).json({ error: 'Tenant not found' });
    const tenant = tenantRes.rows[0];

    const txRes = await pool.query(
      `SELECT * FROM transactions WHERE tenant_id = $1 ORDER BY date ASC, id ASC`,
      [tenant_id]
    );

    const ledger = txRes.rows;
    const lastBalance = ledger.length > 0 ? ledger[ledger.length - 1].running_balance : 0;

    const totalDebit  = ledger.reduce((s, r) => s + (parseFloat(r.debit)  || 0), 0);
    const totalCredit = ledger.reduce((s, r) => s + (parseFloat(r.credit) || 0), 0);

    res.json({ tenant, ledger, totalDebit, totalCredit, totalDue: lastBalance });
  } catch (err) {
    console.error('Error fetching transactions:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/transactions
 * Add a new debit (charge) or credit (payment) or opening balance.
 *
 * Body: {
 *   tenant_id, date, type ('debit'|'credit'|'opening'),
 *   charge_type? ('rent'|'electricity'|'other'),
 *   payment_mode? ('cash'|'phonepay'|'bank'|'cheque'),
 *   debit?, credit?, month_year?, notes?
 *   -- particulars is auto-generated if not provided --
 * }
 */
router.post('/', async (req, res) => {
  try {
    const {
      tenant_id,
      date,
      type,
      charge_type,
      payment_mode,
      debit = 0,
      credit = 0,
      month_year,
      notes = ''
    } = req.body;

    if (!tenant_id || !date || !type) {
      return res.status(400).json({ error: 'tenant_id, date, type are required' });
    }

    // Resolve property_id from tenant
    const tenantRes = await pool.query('SELECT property_id FROM tenants WHERE id = $1', [tenant_id]);
    if (tenantRes.rows.length === 0) return res.status(404).json({ error: 'Tenant not found' });
    const property_id = tenantRes.rows[0].property_id;

    // Auto-generate particulars
    let particulars = req.body.particulars || '';
    if (!particulars) {
      if (type === 'opening') {
        particulars = 'Opening Balance';
      } else if (type === 'debit') {
        const monthLabel = month_year ? formatBillingMonthLabel(month_year) : '';
        if (charge_type === 'rent') {
          particulars = monthLabel ? `${monthLabel} Rent` : 'To Rent';
        } else if (charge_type === 'electricity') {
          particulars = monthLabel ? `${monthLabel} Electricity Bill` : 'To Electricity';
        } else {
          particulars = monthLabel ? `${monthLabel} Other Charge` : 'To Other Charge';
        }
      } else {
        // credit / payment
        const modeLabel = {
          cash: 'Cash Receipt',
          phonepay: 'PhonePe UPI',
          bank: 'Bank Transfer',
          cheque: 'By Cheque',
        }[payment_mode] || 'By Payment';
        particulars = `By ${modeLabel}`;
      }
    }

    // Insert with a placeholder balance (recalcBalances will fix it)
    const insertRes = await pool.query(
      `INSERT INTO transactions
         (tenant_id, property_id, date, type, charge_type, payment_mode, particulars, debit, credit, running_balance, month_year, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,$10,$11)`,
      [tenant_id, property_id, date, type, charge_type || null, payment_mode || null,
       particulars, parseFloat(debit) || 0, parseFloat(credit) || 0, month_year || null, notes]
    );

    // Fetch inserted id
    const newId = insertRes.lastID;

    // Recalculate all balances
    await recalcBalances(tenant_id);
    await syncTransactionsToRentPayments(tenant_id);

    const fetchRes = await pool.query('SELECT * FROM transactions WHERE id = $1', [newId]);
    res.status(201).json(fetchRes.rows[0]);
  } catch (err) {
    console.error('Error creating transaction:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /api/transactions/:id
 * Edit a transaction row. Balance recalculated from that row onwards.
 */
router.patch('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) return res.status(400).json({ error: 'Invalid transaction id' });
    const existing = await pool.query('SELECT * FROM transactions WHERE id = $1', [id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Transaction not found' });
    const tx = existing.rows[0];

    const {
      date        = tx.date,
      type        = tx.type,
      charge_type = tx.charge_type,
      payment_mode = tx.payment_mode,
      particulars = tx.particulars,
      debit       = tx.debit,
      credit      = tx.credit,
      month_year  = tx.month_year,
      notes       = tx.notes
    } = req.body;

    await pool.query(
      `UPDATE transactions
         SET date=$1, type=$2, charge_type=$3, payment_mode=$4, particulars=$5,
             debit=$6, credit=$7, month_year=$8, notes=$9, updated_at=datetime('now')
       WHERE id=$10`,
      [date, type, charge_type, payment_mode, particulars,
       parseFloat(debit) || 0, parseFloat(credit) || 0, month_year, notes, id]
    );

    await recalcBalances(tx.tenant_id);
    await syncTransactionsToRentPayments(tx.tenant_id);

    const fetchRes = await pool.query('SELECT * FROM transactions WHERE id = $1', [id]);
    res.json(fetchRes.rows[0]);
  } catch (err) {
    console.error('Error updating transaction:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/transactions/:id
 * Delete a transaction row and recalculate all subsequent balances.
 */
router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) return res.status(400).json({ error: 'Invalid transaction id' });
    const existing = await pool.query('SELECT * FROM transactions WHERE id = $1', [id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Transaction not found' });
    const { tenant_id } = existing.rows[0];

    await pool.query('DELETE FROM transactions WHERE id = $1', [id]);
    await recalcBalances(tenant_id);
    await syncTransactionsToRentPayments(tenant_id);

    res.json({ message: 'Transaction deleted', deleted_id: id });
  } catch (err) {
    console.error('Error deleting transaction:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
