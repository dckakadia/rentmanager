const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const billingService = require('../services/billingService');

/**
 * GET - List payments for a property or filter by month (FIXED: Use centralized calculation)
 */
router.get('/', async (req, res) => {
  try {
    const { month_year } = req.query;
    if (!month_year) return res.status(400).json({ error: 'month_year is required' });

    const result = await pool.query(`
      SELECT 
        p.id as property_id,
        p.room_number,
        p.property_type,
        t.id as tenant_id,
        t.name as tenant_name,
        t.phone as tenant_phone,
        t.phone as phone,
        t.rent_amount as base_rent,
        t.committed_payment_date,
        rp.id as payment_id,
        rp.amount_paid,
        rp.payment_status,
        rp.payment_date,
        rp.notes,
        rp.base_rent as billed_rent,
        rp.electricity_bill as billed_electricity,
        rp.total_due as billed_total,
        (
          SELECT COALESCE(SUM(total_due - amount_paid), 0)
          FROM rent_payments
          WHERE property_id = p.id AND month_year < $1
        ) as historical_outstanding
      FROM properties p
      JOIN tenants t ON p.id = t.property_id
      LEFT JOIN rent_payments rp ON p.id = rp.property_id AND rp.month_year = $1
      WHERE p.is_occupied = 1 AND t.status = 'active'
      ORDER BY p.room_number
    `, [month_year]);

    const processedRows = await Promise.all(result.rows.map(async (row) => {
      const baseRent = parseFloat(row.billed_rent) || parseFloat(row.base_rent) || 0;
      const electricityBill = parseFloat(row.billed_electricity) || 0;
      const amountPaid = parseFloat(row.amount_paid) || 0;
      const historical = parseFloat(row.historical_outstanding) || 0;
      
      // Fetch the actual real-time running balance from transaction ledger
      const txRes = await pool.query(
        `SELECT running_balance FROM transactions WHERE tenant_id = $1 ORDER BY date DESC, id DESC LIMIT 1`,
        [row.tenant_id]
      );
      const totalDue = txRes.rows.length > 0 ? parseFloat(txRes.rows[0].running_balance) : 0;
      const balance = totalDue;

      // Fetch historical breakdown if there's an outstanding balance
      let breakdown = [];
      if (historical > 0) {
        const historyRes = await pool.query(
          `SELECT month_year, base_rent, electricity_bill, (total_due - amount_paid) as balance 
           FROM rent_payments 
           WHERE property_id = $1 AND (total_due - amount_paid) > 0 AND month_year < $2
           ORDER BY month_year DESC`,
          [row.property_id, month_year]
        );
        breakdown = historyRes.rows;
      }

      return {
        property_id: row.property_id,
        room_number: row.room_number,
        property_type: row.property_type,
        tenant_id: row.tenant_id,
        tenant_name: row.tenant_name,
        tenant_phone: row.tenant_phone,
        payment_id: row.payment_id,
        base_rent: baseRent,
        electricity_bill: electricityBill,
        current_month_due: baseRent + electricityBill,
        historical_outstanding: historical,
        total_due: totalDue,
        amount_paid: amountPaid,
        balance: balance,
        payment_status: row.payment_status || 'unbilled',
        payment_date: row.payment_date,
        notes: row.notes,
        outstanding_breakdown: breakdown,
        committed_payment_date: row.committed_payment_date
      };
    }));

    res.json(processedRows);
  } catch (error) {
    console.error('Error fetching payments:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST - Record a payment (FIXED: No more addition bug)
 * 
 * FIXED LOGIC:
 * 1. Check if bill exists for this month - if not, create it
 * 2. Check for duplicate payments (same property, same month, same date)
 * 3. Use REPLACE logic (new payment replaces the old amount_paid)
 * 4. Only track multiple payments via corrections table (audit trail)
 * 5. Validate amount doesn't exceed total_due
 */
router.post('/', async (req, res) => {
  try {
    const {
      property_id,
      month_year,
      amount_paid,
      payment_date = new Date().toISOString().split('T')[0],
      notes = '',
    } = req.body;

    // Validation
    if (!property_id || !month_year || amount_paid === undefined) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        details: [
          { field: 'property_id', message: 'Required' },
          { field: 'month_year', message: 'Required (YYYY-MM format)' },
          { field: 'amount_paid', message: 'Required' }
        ]
      });
    }

    if (typeof amount_paid !== 'number' || amount_paid <= 0) {
      return res.status(400).json({ 
        error: 'Validation Error',
        details: [{ field: 'amount_paid', message: 'Must be a positive number' }]
      });
    }

    const propertyId = parseInt(property_id);
    if (isNaN(propertyId) || propertyId <= 0) {
      return res.status(400).json({ 
        error: 'Validation Error',
        details: [{ field: 'property_id', message: 'Must be a valid property ID' }]
      });
    }

    // 1. Ensure bill exists for this month (create if needed)
    let billResult = await pool.query(
      'SELECT * FROM rent_payments WHERE property_id = $1 AND month_year = $2',
      [propertyId, month_year]
    );

    if (billResult.rows.length === 0) {
      // Bill doesn't exist - create it using billing service
      const billData = await billingService.calculateTotalDue(propertyId, month_year);
      if (billData.totalDue === 0 && billData.baseRent === 0) {
        return res.status(400).json({ 
          error: 'Cannot create payment',
          details: [{ message: 'No active tenant or no bill exists for this property' }]
        });
      }

      await pool.query(
        `INSERT INTO rent_payments 
         (property_id, month_year, base_rent, electricity_bill, total_due, amount_paid, payment_status)
         VALUES ($1, $2, $3, $4, $5, 0, 'pending')`,
        [propertyId, month_year, billData.baseRent, billData.electricityBill, billData.totalDue]
      );

      billResult = await pool.query(
        'SELECT * FROM rent_payments WHERE property_id = $1 AND month_year = $2',
        [propertyId, month_year]
      );
    }

    const bill = billResult.rows[0];

    // 2. Validate amount doesn't exceed total_due
    if (amount_paid > bill.total_due) {
      return res.status(400).json({ 
        error: 'Validation Error',
        details: [{ 
          field: 'amount_paid', 
          message: `Cannot exceed total due (₹${bill.total_due}). Amount: ₹${amount_paid}` 
        }]
      });
    }

    // 3. Check for DUPLICATE payment (same property, month, date, amount)
    const duplicateCheck = await pool.query(
      `SELECT * FROM rent_payments 
       WHERE property_id = $1 AND month_year = $2 AND amount_paid = $3 AND payment_date = $4`,
      [propertyId, month_year, amount_paid, payment_date]
    );

    if (duplicateCheck.rows.length > 0 && duplicateCheck.rows[0].id === bill.id) {
      return res.status(409).json({ 
        error: 'Duplicate Payment Detected',
        details: [{ 
          message: `This exact payment (₹${amount_paid} on ${payment_date}) was already recorded for this month` 
        }],
        existing_payment: bill
      });
    }

    // 4. Log old payment amount (if changing)
    if (bill.amount_paid > 0 && bill.amount_paid !== amount_paid) {
      await pool.query(
        `INSERT INTO payment_corrections (payment_id, old_amount, new_amount, reason, corrected_at)
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
        [bill.id, bill.amount_paid, amount_paid, `New payment recorded: ${notes || 'No reason provided'}`]
      );
    }

    // 5. Update payment - REPLACE (not ADD) the amount
    let paymentStatus = 'pending';
    if (amount_paid >= bill.total_due) {
      paymentStatus = 'paid';
    } else if (amount_paid > 0) {
      paymentStatus = 'partial';
    }

    await pool.query(
      `UPDATE rent_payments 
       SET amount_paid = $1, 
           payment_status = $2, 
           payment_date = $3, 
           notes = $4, 
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $5`,
      [amount_paid, paymentStatus, payment_date, notes, bill.id]
    );

    // Synchronize to transaction ledger
    try {
      const tenantRes = await pool.query(
        `SELECT id FROM tenants WHERE property_id = $1 AND status = 'active'`,
        [propertyId]
      );
      if (tenantRes.rows.length > 0) {
        const tenantId = tenantRes.rows[0].id;
        const lowerNotes = (notes || '').toLowerCase();
        let paymentMode = 'cash';
        let particulars = 'By Cash Receipt';
        if (lowerNotes.includes('upi') || lowerNotes.includes('phone') || lowerNotes.includes('gpay') || lowerNotes.includes('paytm')) {
          paymentMode = 'phonepay';
          particulars = 'By PhonePe UPI';
        } else if (lowerNotes.includes('bank') || lowerNotes.includes('neft') || lowerNotes.includes('transfer') || lowerNotes.includes('rtgs')) {
          paymentMode = 'bank';
          particulars = 'By Bank Transfer';
        } else if (lowerNotes.includes('cheque')) {
          paymentMode = 'cheque';
          particulars = 'By Cheque';
        }

        // Check if there is already an identical transaction to prevent duplicate credit entries
        const dupTxCheck = await pool.query(
          `SELECT id FROM transactions 
           WHERE tenant_id = $1 AND date = $2 AND type = 'credit' AND credit = $3 AND month_year = $4`,
          [tenantId, payment_date, amount_paid, month_year]
        );

        if (dupTxCheck.rows.length === 0) {
          await pool.query(
            `INSERT INTO transactions 
               (tenant_id, property_id, date, type, payment_mode, particulars, debit, credit, running_balance, month_year, notes)
             VALUES ($1, $2, $3, 'credit', $4, $5, 0, $6, 0, $7, $8)`,
            [tenantId, propertyId, payment_date, paymentMode, particulars, amount_paid, month_year, notes]
          );
        }

        const { recalcBalances, syncTransactionsToRentPayments } = require('../utils/ledgerSync');
        await recalcBalances(tenantId);
        await syncTransactionsToRentPayments(tenantId);
      }
    } catch (syncError) {
      console.error('[Payment Sync Error] Failed to sync payment to transaction ledger:', syncError.message);
    }

    // 6. Fetch updated record
    const updatedPayment = await pool.query(
      'SELECT * FROM rent_payments WHERE id = $1',
      [bill.id]
    );

    const finalPayment = updatedPayment.rows[0];


    console.log(`[Payment] Payment recorded for property ${propertyId}, month ${month_year}: ₹${amount_paid}`);
    res.status(201).json(finalPayment);
  } catch (error) {
    console.error('Error recording payment:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET - Payment history for a property
 */
router.get('/history/:property_id', async (req, res) => {
  try {
    const { property_id } = req.params;
    const result = await pool.query(
      'SELECT * FROM rent_payments WHERE property_id = $1 ORDER BY month_year DESC LIMIT 12',
      [property_id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching payment history:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PATCH - Update a specific payment record (Correction)
 */
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { amount_paid, payment_date, notes, correction_reason } = req.body;

    // 1. Get the current record to recalculate status and log the change
    const paymentRes = await pool.query(
      'SELECT * FROM rent_payments WHERE id = $1',
      [id]
    );
    if (paymentRes.rows.length === 0) {
      return res.status(404).json({ error: 'Payment record not found' });
    }
    const payment = paymentRes.rows[0];

    // 2. Validate input
    if (amount_paid !== undefined && (typeof amount_paid !== 'number' || amount_paid < 0)) {
      return res.status(400).json({ 
        error: 'Validation Error',
        details: [{ field: 'amount_paid', message: 'Amount must be a non-negative number' }]
      });
    }

    const newAmountPaid = amount_paid !== undefined ? amount_paid : payment.amount_paid;
    const total_due = payment.total_due;

    // 3. Recalculate status
    let status = 'pending';
    if (newAmountPaid >= total_due) status = 'paid';
    else if (newAmountPaid > 0) status = 'partial';

    // 4. Log correction in audit trail
    const oldAmountPaid = payment.amount_paid;
    if (oldAmountPaid !== newAmountPaid) {
      await pool.query(
        `INSERT INTO payment_corrections (payment_id, old_amount, new_amount, reason, corrected_at)
         VALUES ($1, $2, $3, $4, datetime('now'))`,
        [id, oldAmountPaid, newAmountPaid, correction_reason || 'Manual correction']
      );
    }

    // 5. Update payment
    await pool.query(
      `UPDATE rent_payments 
       SET amount_paid = $1, payment_status = $2, payment_date = $3, notes = $4, updated_at = CURRENT_TIMESTAMP
       WHERE id = $5`,
      [newAmountPaid, status, payment_date || payment.payment_date, notes || payment.notes, id]
    );

    // Sync to transactions
    try {
      const tenantRes = await pool.query(
        `SELECT id FROM tenants WHERE property_id = $1 AND status = 'active'`,
        [payment.property_id]
      );
      if (tenantRes.rows.length > 0) {
        const tenantId = tenantRes.rows[0].id;
        const txRes = await pool.query(
          `SELECT id FROM transactions 
           WHERE tenant_id = $1 AND month_year = $2 AND type = 'credit' AND credit = $3 LIMIT 1`,
          [tenantId, payment.month_year, oldAmountPaid]
        );

        const lowerNotes = (notes || payment.notes || '').toLowerCase();
        let paymentMode = 'cash';
        let particulars = 'By Cash Receipt';
        if (lowerNotes.includes('upi') || lowerNotes.includes('phone') || lowerNotes.includes('gpay') || lowerNotes.includes('paytm')) {
          paymentMode = 'phonepay';
          particulars = 'By PhonePe UPI';
        } else if (lowerNotes.includes('bank') || lowerNotes.includes('neft') || lowerNotes.includes('transfer') || lowerNotes.includes('rtgs')) {
          paymentMode = 'bank';
          particulars = 'By Bank Transfer';
        } else if (lowerNotes.includes('cheque')) {
          paymentMode = 'cheque';
          particulars = 'By Cheque';
        }

        if (txRes.rows.length > 0) {
          await pool.query(
            `UPDATE transactions 
             SET credit = $1, date = $2, notes = $3, payment_mode = $4, particulars = $5, updated_at = CURRENT_TIMESTAMP
             WHERE id = $6`,
            [newAmountPaid, payment_date || payment.payment_date, notes || payment.notes, paymentMode, particulars, txRes.rows[0].id]
          );
        } else {
          // If no matching transaction found, insert it
          await pool.query(
            `INSERT INTO transactions 
               (tenant_id, property_id, date, type, payment_mode, particulars, debit, credit, running_balance, month_year, notes)
             VALUES ($1, $2, $3, 'credit', $4, $5, 0, $6, 0, $7, $8)`,
            [tenantId, payment.property_id, payment_date || payment.payment_date, paymentMode, particulars, newAmountPaid, payment.month_year, notes || payment.notes]
          );
        }

        const { recalcBalances, syncTransactionsToRentPayments } = require('../utils/ledgerSync');
        await recalcBalances(tenantId);
        await syncTransactionsToRentPayments(tenantId);
      }
    } catch (syncError) {
      console.error('[Payment Sync Error] Failed to sync payment correction:', syncError.message);
    }

    const selectRes = await pool.query('SELECT * FROM rent_payments WHERE id = $1', [id]);
    

    res.json(selectRes.rows[0]);
  } catch (error) {
    console.error('Error correcting payment:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE - Remove a payment record (for erroneous entries only)
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    // 1. Fetch payment to log deletion
    const paymentRes = await pool.query('SELECT * FROM rent_payments WHERE id = $1', [id]);
    if (paymentRes.rows.length === 0) {
      return res.status(404).json({ error: 'Payment record not found' });
    }
    const payment = paymentRes.rows[0];

    // 2. Log deletion
    await pool.query(
      `INSERT INTO payment_corrections (payment_id, old_amount, new_amount, reason, corrected_at)
       VALUES ($1, $2, $3, $4, datetime('now'))`,
      [id, payment.amount_paid, 0, `DELETED: ${reason || 'No reason provided'}`]
    );

    // 3. Delete record
    await pool.query('DELETE FROM rent_payments WHERE id = $1', [id]);

    // Sync to transactions
    try {
      const tenantRes = await pool.query(
        `SELECT id FROM tenants WHERE property_id = $1 AND status = 'active'`,
        [payment.property_id]
      );
      if (tenantRes.rows.length > 0) {
        const tenantId = tenantRes.rows[0].id;
        await pool.query(
          `DELETE FROM transactions 
           WHERE tenant_id = $1 AND month_year = $2 AND type = 'credit' AND credit = $3`,
          [tenantId, payment.month_year, payment.amount_paid]
        );
        const { recalcBalances, syncTransactionsToRentPayments } = require('../utils/ledgerSync');
        await recalcBalances(tenantId);
        await syncTransactionsToRentPayments(tenantId);
      }
    } catch (syncError) {
      console.error('[Payment Sync Error] Failed to sync payment deletion:', syncError.message);
    }

    res.json({ 
      message: 'Payment record deleted successfully',
      deleted_id: id,
      reason: reason || 'No reason provided'
    });
  } catch (error) {
    console.error('Error deleting payment:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST - Trigger bill generation for all units
 */
router.post('/generate-bills', async (req, res) => {
  try {
    const { month_year } = req.body; // Expects "YYYY-MM"
    if (!month_year) return res.status(400).json({ error: 'month_year is required' });

    const result = await billingService.generateAllBills(month_year);
    if (result.success) {
      res.json({ message: `Successfully generated ${result.processed} bills for ${month_year}` });
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (error) {
    console.error('Error manually generating bills:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
