const pool = require('../config/database');

function formatBillingMonthLabel(monthYear) {
  const [year, month] = monthYear.split('-');
  const monthNum = parseInt(month, 10) - 1;
  const dateObj = new Date(parseInt(year, 10), monthNum, 1);
  const monthName = dateObj.toLocaleString('en-IN', { month: 'long' });
  return `${monthName} Month`;
}

/**
 * Recalculate running_balance for ALL transactions of a tenant chronologically.
 * Must be called after any insert, update, or delete on the transactions table.
 * 
 * BUG#4 FIX: Properly handle opening balance and transaction ordering
 */
async function recalcBalances(tenantId) {
  const rows = await pool.query(
    `SELECT id, type, debit, credit FROM transactions WHERE tenant_id = $1 ORDER BY date ASC, id ASC`,
    [tenantId]
  );

  let balance = 0;
  for (const row of rows.rows) {
    let debit = parseFloat(row.debit) || 0;
    let credit = parseFloat(row.credit) || 0;

    // BUG#4 FIX: Handle opening balance specially (it sets the starting point, not adds to it)
    if (row.type === 'opening') {
      balance = debit;  // Opening balance is the starting balance
      console.log(`[LEDGER] Opening balance: ₹${balance}`);
    } else {
      balance = balance + debit - credit;
    }

    await pool.query(
      `UPDATE transactions SET running_balance = $1, updated_at = datetime('now') WHERE id = $2`,
      [balance, row.id]
    );
  }
  return balance;
}

/**
 * Allocate all credit transactions (payments) chronologically (oldest month first)
 * to the tenant's rent_payments billing records.
 */
async function syncTransactionsToRentPayments(tenantId) {
  // 1. Get tenant details
  const tenantRes = await pool.query(
    `SELECT property_id, rental_start_date FROM tenants WHERE id = $1`,
    [tenantId]
  );
  if (tenantRes.rows.length === 0) return;
  const { property_id, rental_start_date } = tenantRes.rows[0];

  // 2. Fetch all credit transactions for this tenant
  const creditRes = await pool.query(
    `SELECT COALESCE(SUM(credit), 0) as total_credits 
     FROM transactions 
     WHERE tenant_id = $1 AND type = 'credit'`,
    [tenantId]
  );
  let remainingCredit = parseFloat(creditRes.rows[0].total_credits) || 0;

  // 3. Fetch all rent payments for this property from rental_start_date onwards
  const startMonth = rental_start_date.substring(0, 7); // YYYY-MM
  const paymentsRes = await pool.query(
    `SELECT id, month_year, total_due, amount_paid, payment_status, payment_date
     FROM rent_payments 
     WHERE property_id = $1 AND month_year >= $2 
     ORDER BY month_year ASC`,
    [property_id, startMonth]
  );

  // 4. Distribute credits chronologically (oldest month first)
  for (const payment of paymentsRes.rows) {
    const totalDue = parseFloat(payment.total_due) || 0;
    let newAmountPaid = 0;

    if (remainingCredit >= totalDue) {
      newAmountPaid = totalDue;
      remainingCredit -= totalDue;
    } else {
      newAmountPaid = remainingCredit;
      remainingCredit = 0;
    }

    let newStatus = 'pending';
    if (newAmountPaid >= totalDue && totalDue > 0) {
      newStatus = 'paid';
    } else if (newAmountPaid > 0) {
      newStatus = 'partial';
    }

    // Only update if there is a change to avoid unnecessary writes/locks
    if (parseFloat(payment.amount_paid) !== newAmountPaid || payment.payment_status !== newStatus) {
      // Find the payment date from transactions to set as payment_date if paid
      let paymentDate = null;
      if (newAmountPaid > 0) {
        const dateRes = await pool.query(
          `SELECT date FROM transactions 
           WHERE tenant_id = $1 AND type = 'credit' AND month_year = $2
           ORDER BY date DESC LIMIT 1`,
          [tenantId, payment.month_year]
        );
        if (dateRes.rows.length > 0) {
          paymentDate = dateRes.rows[0].date;
        } else {
          // Fallback to the latest credit transaction date overall
          const fallbackRes = await pool.query(
            `SELECT date FROM transactions 
             WHERE tenant_id = $1 AND type = 'credit'
             ORDER BY date DESC LIMIT 1`,
            [tenantId]
          );
          paymentDate = fallbackRes.rows[0]?.date || new Date().toISOString().split('T')[0];
        }
      }

      await pool.query(
        `UPDATE rent_payments 
         SET amount_paid = $1, payment_status = $2, payment_date = $3, updated_at = datetime('now')
         WHERE id = $4`,
        [newAmountPaid, newStatus, paymentDate, payment.id]
      );
    }
  }
}

/**
 * Synchronize generated/updated billing records to transaction debits.
 */
async function syncBillToTransactions(propertyId, monthYear, baseRent, electricityBill) {
  // 1. Find active tenant
  const tenantRes = await pool.query(
    `SELECT id, rental_start_date FROM tenants WHERE property_id = $1 AND status = 'active'`,
    [propertyId]
  );
  if (tenantRes.rows.length === 0) return;
  const tenantId = tenantRes.rows[0].id;
  const rentalStartDate = tenantRes.rows[0].rental_start_date;

  // Check if month_year is before rental_start_date
  if (monthYear < rentalStartDate.substring(0, 7)) return;

  const monthLabel = formatBillingMonthLabel(monthYear);

  // A. Rent Debit
  if (baseRent > 0) {
    const rentDate = `${monthYear}-01`;
    const rentParticulars = `${monthLabel} Rent`;

    const existingRent = await pool.query(
      `SELECT id, debit FROM transactions 
       WHERE tenant_id = $1 AND month_year = $2 AND type = 'debit' AND charge_type = 'rent'`,
      [tenantId, monthYear]
    );

    if (existingRent.rows.length > 0) {
      if (parseFloat(existingRent.rows[0].debit) !== baseRent) {
        await pool.query(
          `UPDATE transactions SET debit = $1, updated_at = datetime('now') WHERE id = $2`,
          [baseRent, existingRent.rows[0].id]
        );
      }
    } else {
      await pool.query(
        `INSERT INTO transactions 
           (tenant_id, property_id, date, type, charge_type, particulars, debit, credit, running_balance, month_year, notes)
         VALUES ($1, $2, $3, 'debit', 'rent', $4, $5, 0, 0, $6, '')`,
        [tenantId, propertyId, rentDate, rentParticulars, baseRent, monthYear]
      );
    }
  } else {
    await pool.query(
      `DELETE FROM transactions 
       WHERE tenant_id = $1 AND month_year = $2 AND type = 'debit' AND charge_type = 'rent'`,
      [tenantId, monthYear]
    );
  }

  // B. Electricity Debit
  if (electricityBill > 0) {
    const elecDate = `${monthYear}-05`;
    const elecParticulars = `${monthLabel} Electricity Bill`;

    const existingElec = await pool.query(
      `SELECT id, debit FROM transactions 
       WHERE tenant_id = $1 AND month_year = $2 AND type = 'debit' AND charge_type = 'electricity'`,
      [tenantId, monthYear]
    );

    if (existingElec.rows.length > 0) {
      if (parseFloat(existingElec.rows[0].debit) !== electricityBill) {
        await pool.query(
          `UPDATE transactions SET debit = $1, updated_at = datetime('now') WHERE id = $2`,
          [electricityBill, existingElec.rows[0].id]
        );
      }
    } else {
      await pool.query(
        `INSERT INTO transactions 
           (tenant_id, property_id, date, type, charge_type, particulars, debit, credit, running_balance, month_year, notes)
         VALUES ($1, $2, $3, 'debit', 'electricity', $4, $5, 0, 0, $6, '')`,
        [tenantId, propertyId, elecDate, elecParticulars, electricityBill, monthYear]
      );
    }
  } else {
    await pool.query(
      `DELETE FROM transactions 
       WHERE tenant_id = $1 AND month_year = $2 AND type = 'debit' AND charge_type = 'electricity'`,
      [tenantId, monthYear]
    );
  }

  // Recalculate balances & sync allocations
  await recalcBalances(tenantId);
  await syncTransactionsToRentPayments(tenantId);
}

/**
 * Utility to run a full synchronization for all active tenants to correct any database discrepancies.
 */
async function syncAllActiveTenants() {
  console.log('[LedgerSync] Starting full synchronization for all active tenants...');
  const tenants = await pool.query(
    `SELECT id, name FROM tenants WHERE status = 'active'`
  );
  
  for (const tenant of tenants.rows) {
    await recalcBalances(tenant.id);
    await syncTransactionsToRentPayments(tenant.id);
    console.log(`[LedgerSync] Resynced balances and payments for tenant ${tenant.name} (ID: ${tenant.id})`);
  }
  console.log('[LedgerSync] Full synchronization completed successfully!');
}

module.exports = {
  formatBillingMonthLabel,
  recalcBalances,
  syncTransactionsToRentPayments,
  syncBillToTransactions,
  syncAllActiveTenants
};
