/**
 * Late Payment Penalties & Interest Management
 * 
 * Configurable penalties for late payments with audit trail
 * 
 * FEATURES:
 * - Fixed or percentage-based penalties
 * - Configurable grace period
 * - Automatic calculation of late fees
 * - Detailed breakdown for receipts
 */

const pool = require('../config/database');

/**
 * Initialize late_fee settings (one-time)
 */
async function initializeLateFeesSettings() {
  try {
    // Check if settings table has late_fees columns
    const result = await pool.query(`PRAGMA table_info(settings)`);
    const hasLateFeesColumns = result.rows.some(r => r.name === 'late_fee_enabled');

    if (!hasLateFeesColumns) {
      // Add late fee columns
      await pool.query(`ALTER TABLE settings ADD COLUMN late_fee_enabled INTEGER DEFAULT 0`);
      await pool.query(`ALTER TABLE settings ADD COLUMN late_fee_amount REAL DEFAULT 0`);
      await pool.query(`ALTER TABLE settings ADD COLUMN late_fee_type TEXT DEFAULT 'fixed'`);
      // fixed = ₹X fixed amount, percentage = X% of bill
      await pool.query(`ALTER TABLE settings ADD COLUMN grace_days INTEGER DEFAULT 3`);
      
      console.log('✓ Late fees settings columns added');
    }

    // Create late_fees_log table for audit trail
    await pool.query(`
      CREATE TABLE IF NOT EXISTS late_fees_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        payment_id INTEGER NOT NULL REFERENCES rent_payments(id) ON DELETE CASCADE,
        property_id INTEGER NOT NULL REFERENCES properties(id),
        month_year TEXT NOT NULL,
        base_bill REAL NOT NULL,
        days_overdue INTEGER NOT NULL,
        grace_days INTEGER NOT NULL,
        fee_amount REAL NOT NULL,
        fee_type TEXT NOT NULL,
        applied_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        waived INTEGER DEFAULT 0,
        waive_reason TEXT,
        waived_by TEXT,
        waived_date DATETIME
      )
    `);
    console.log('✓ late_fees_log table initialized');

  } catch (error) {
    if (!error.message.includes('already exists')) {
      console.error('Error initializing late fees:', error);
      throw error;
    }
  }
}

/**
 * Calculate late fees for a payment
 * 
 * RETURNS:
 * {
 *   has_late_fee: true,
 *   days_overdue: 5,
 *   fee_amount: 500,
 *   total_with_fee: 5500,
 *   breakdown: { base_bill: 5000, late_fee: 500 }
 * }
 */
async function calculateLateFees(propertyId, monthYear, amountDue, committedPaymentDate, paymentDate) {
  try {
    // Get settings
    const settingsResult = await pool.query(`SELECT * FROM settings LIMIT 1`);
    const settings = settingsResult.rows[0] || {};

    // Check if late fees enabled
    if (!settings.late_fee_enabled) {
      return {
        has_late_fee: false,
        fee_amount: 0,
        total_with_fee: amountDue,
        breakdown: { base_bill: amountDue }
      };
    }

    // Calculate due date
    const [year, month] = monthYear.split('-').map(Number);
    const dueDate = new Date(year, month - 1, committedPaymentDate || 1);
    
    // Add grace period
    const gracePeriodDays = settings.grace_days || 0;
    const lateStartDate = new Date(dueDate);
    lateStartDate.setDate(lateStartDate.getDate() + gracePeriodDays);

    // Parse payment date (fallback to now if invalid)
    let paymentDateObj = new Date(paymentDate);
    if (isNaN(paymentDateObj.getTime())) {
      paymentDateObj = new Date();
    }

    // If paid within grace period, no fee
    if (paymentDateObj <= lateStartDate) {
      return {
        has_late_fee: false,
        fee_amount: 0,
        total_with_fee: amountDue,
        breakdown: { base_bill: amountDue },
        status: 'on_time',
        due_date: dueDate.toISOString().split('T')[0],
        grace_period_ends: lateStartDate.toISOString().split('T')[0]
      };
    }

    // Calculate days overdue
    const msPerDay = 1000 * 60 * 60 * 24;
    const daysOverdue = Math.ceil((paymentDateObj - lateStartDate) / msPerDay);

    // Calculate fee based on type
    let feeAmount = 0;

    if (settings.late_fee_type === 'fixed') {
      // Fixed fee per day or fixed total
      // Assuming late_fee_amount is the daily rate
      feeAmount = settings.late_fee_amount * daysOverdue;
      // Cap at reasonable maximum (e.g., 50% of bill)
      feeAmount = Math.min(feeAmount, amountDue * 0.5);
    } else if (settings.late_fee_type === 'percentage') {
      // Percentage of bill
      // Assuming late_fee_amount is the percentage rate
      feeAmount = (amountDue * settings.late_fee_amount / 100) * daysOverdue / 30;
      // Cap at reasonable maximum
      feeAmount = Math.min(feeAmount, amountDue * 0.5);
    } else if (settings.late_fee_type === 'compound_daily') {
      // Compound daily interest (more punitive)
      const dailyRate = settings.late_fee_amount / 100;
      feeAmount = amountDue * (Math.pow(1 + dailyRate, daysOverdue) - 1);
      feeAmount = Math.min(feeAmount, amountDue * 0.5);
    }

    // Round to 2 decimals
    feeAmount = Math.round(feeAmount * 100) / 100;
    const totalWithFee = amountDue + feeAmount;

    return {
      has_late_fee: true,
      days_overdue: daysOverdue,
      fee_amount: feeAmount,
      total_with_fee: Math.round(totalWithFee * 100) / 100,
      breakdown: {
        base_bill: amountDue,
        late_fee: feeAmount,
        grace_period_days: gracePeriodDays,
        fee_rate: `${settings.late_fee_amount} ${settings.late_fee_type}`
      },
      status: 'late',
      due_date: dueDate.toISOString().split('T')[0],
      grace_period_ends: lateStartDate.toISOString().split('T')[0],
      payment_date: paymentDate
    };

  } catch (error) {
    console.error('Error calculating late fees:', error);
    throw error;
  }
}

/**
 * Log a late fee charge
 */
async function logLateFee(paymentId, propertyId, monthYear, baseBill, daysOverdue, feeAmount, feeType) {
  try {
    const settingsResult = await pool.query(`SELECT grace_days FROM settings LIMIT 1`);
    const graceDays = settingsResult.rows[0]?.grace_days || 0;

    await pool.query(
      `INSERT INTO late_fees_log 
       (payment_id, property_id, month_year, base_bill, days_overdue, grace_days, fee_amount, fee_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [paymentId, propertyId, monthYear, baseBill, daysOverdue, graceDays, feeAmount, feeType]
    );

    return { success: true };
  } catch (error) {
    console.error('Error logging late fee:', error);
    throw error;
  }
}

/**
 * Waive a late fee (with audit trail)
 */
async function waivelLateFee(lateFeesLogId, reason, waivedBy) {
  try {
    await pool.query(
      `UPDATE late_fees_log 
       SET waived = 1, waive_reason = $1, waived_by = $2, waived_date = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [reason, waivedBy, lateFeesLogId]
    );

    console.log(`[Late Fee] Waived fee ${lateFeesLogId} - Reason: ${reason}`);
    return { success: true };
  } catch (error) {
    console.error('Error waiving late fee:', error);
    throw error;
  }
}

/**
 * Get late fees history for a property
 */
async function getLateFeesHistory(propertyId, months = 12) {
  try {
    const result = await pool.query(
      `SELECT * FROM late_fees_log 
       WHERE property_id = $1
       ORDER BY applied_date DESC
       LIMIT $2`,
      [propertyId, months]
    );

    const summary = {
      total_fees_charged: 0,
      total_fees_waived: 0,
      total_fees_collected: 0,
      late_payments_count: result.rows.length,
      entries: result.rows
    };

    result.rows.forEach(entry => {
      const fee = parseFloat(entry.fee_amount) || 0;
      summary.total_fees_charged += fee;
      if (entry.waived) {
        summary.total_fees_waived += fee;
      } else {
        summary.total_fees_collected += fee;
      }
    });

    return summary;
  } catch (error) {
    console.error('Error fetching late fees history:', error);
    throw error;
  }
}

/**
 * Update late fees settings
 */
async function updateLateFeeSettings(updateData) {
  const {
    late_fee_enabled,
    late_fee_amount,
    late_fee_type,
    grace_days
  } = updateData;

  try {
    const updates = [];
    const values = [];
    
    if (late_fee_enabled !== undefined) {
      updates.push(`late_fee_enabled = $${values.length + 1}`);
      values.push(late_fee_enabled ? 1 : 0);
    }

    if (late_fee_amount !== undefined) {
      updates.push(`late_fee_amount = $${values.length + 1}`);
      values.push(late_fee_amount);
    }

    if (late_fee_type !== undefined) {
      if (!['fixed', 'percentage', 'compound_daily'].includes(late_fee_type)) {
        throw new Error(`Invalid late_fee_type: ${late_fee_type}`);
      }
      updates.push(`late_fee_type = $${values.length + 1}`);
      values.push(late_fee_type);
    }

    if (grace_days !== undefined) {
      updates.push(`grace_days = $${values.length + 1}`);
      values.push(grace_days);
    }

    if (updates.length === 0) {
      return { success: false, message: 'No updates provided' };
    }

    await pool.query(
      `UPDATE settings SET ${updates.join(', ')} WHERE id = 1`,
      values
    );

    console.log(`[Late Fees] Settings updated:`, updateData);
    return { success: true, updated: updateData };
  } catch (error) {
    console.error('Error updating late fee settings:', error);
    throw error;
  }
}

/**
 * Get current late fee settings
 */
async function getLateFeeSettings() {
  try {
    const result = await pool.query(
      `SELECT late_fee_enabled, late_fee_amount, late_fee_type, grace_days 
       FROM settings LIMIT 1`
    );

    if (result.rows.length === 0) {
      return {
        late_fee_enabled: false,
        late_fee_amount: 0,
        late_fee_type: 'fixed',
        grace_days: 3
      };
    }

    return result.rows[0];
  } catch (error) {
    console.error('Error fetching late fee settings:', error);
    throw error;
  }
}

module.exports = {
  initializeLateFeesSettings,
  calculateLateFees,
  logLateFee,
  waivelLateFee,
  // Alias with correct spelling for external callers
  waiveLateFee: waivelLateFee,
  getLateFeesHistory,
  updateLateFeeSettings,
  getLateFeeSettings
};
