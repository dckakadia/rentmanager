/**
 * Rent Change History Management
 * 
 * Tracks all rent changes and provides prorated billing calculations
 * 
 * FEATURES:
 * - Track when rent changes occur
 * - Calculate prorated rent for partial months
 * - Maintain audit trail of all changes
 * - Support multiple rent changes in one month
 */

const pool = require('../config/database');

/**
 * Initialize rent_history table (one-time migration)
 */
async function initializeRentHistoryTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS rent_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
        tenant_id INTEGER REFERENCES tenants(id),
        old_rent REAL,
        new_rent REAL NOT NULL,
        effective_date TEXT NOT NULL,
        reason TEXT,
        changed_by TEXT DEFAULT 'system',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(property_id, effective_date)
      )
    `);
    console.log('✓ rent_history table initialized');
  } catch (error) {
    if (error.message.includes('already exists')) {
      console.log('✓ rent_history table already exists');
    } else {
      throw error;
    }
  }
}

/**
 * Record a rent change
 * 
 * USAGE:
 * await recordRentChange(propertyId, {
 *   old_rent: 5000,
 *   new_rent: 5500,
 *   effective_date: '2026-06-01',
 *   reason: 'Annual increment',
 *   changed_by: 'admin_user'
 * })
 */
async function recordRentChange(propertyId, changeData) {
  const {
    old_rent,
    new_rent,
    effective_date,
    reason = '',
    changed_by = 'system'
  } = changeData;

  try {
    // Validation
    if (!new_rent || new_rent <= 0) {
      throw new Error('new_rent must be a positive number');
    }

    if (!effective_date || !/^\d{4}-\d{2}-\d{2}$/.test(effective_date)) {
      throw new Error('effective_date must be in YYYY-MM-DD format');
    }

    // Get tenant info if available
    const tenantResult = await pool.query(
      'SELECT id FROM tenants WHERE property_id = $1 AND status = $2',
      [propertyId, 'active']
    );
    const tenantId = tenantResult.rows[0]?.id || null;

    // Record the change
    await pool.query(
      `INSERT INTO rent_history 
       (property_id, tenant_id, old_rent, new_rent, effective_date, reason, changed_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [propertyId, tenantId, old_rent || null, new_rent, effective_date, reason, changed_by]
    );

    // Update tenant's rent_amount
    if (tenantId) {
      await pool.query(
        'UPDATE tenants SET rent_amount = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [new_rent, tenantId]
      );
    }

    console.log(`[Rent Change] Property ${propertyId}: ₹${old_rent} → ₹${new_rent} effective ${effective_date}`);
    
    return {
      success: true,
      old_rent,
      new_rent,
      effective_date,
      reason
    };
  } catch (error) {
    console.error('Error recording rent change:', error);
    throw error;
  }
}

/**
 * Get rent history for a property
 */
async function getRentHistory(propertyId) {
  try {
    const result = await pool.query(
      `SELECT * FROM rent_history 
       WHERE property_id = $1 
       ORDER BY effective_date DESC`,
      [propertyId]
    );

    return result.rows;
  } catch (error) {
    console.error('Error fetching rent history:', error);
    throw error;
  }
}

/**
 * Calculate rent for a specific month with proration
 * 
 * RETURNS:
 * {
 *   month: '2026-04',
 *   rent_amount: 5250,
 *   prorated: true,
 *   changes: [
 *     { old_rent: 5000, new_rent: 5500, effective_date: '2026-04-15', days: 15 }
 *   ]
 * }
 */
async function calculateRentForMonth(propertyId, monthYear) {
  try {
    const [year, month] = monthYear.split('-').map(Number);
    
    // Parse month boundaries
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 0);
    const daysInMonth = monthEnd.getDate();
    
    const monthStartStr = monthYear + '-01';
    const monthEndStr = `${monthYear}-${String(daysInMonth).padStart(2, '0')}`;

    // Get rent changes during this month
    const changesResult = await pool.query(
      `SELECT * FROM rent_history 
       WHERE property_id = $1 
       AND effective_date >= $2 
       AND effective_date <= $3
       ORDER BY effective_date ASC`,
      [propertyId, monthStartStr, monthEndStr]
    );

    if (changesResult.rows.length === 0) {
      // No changes - use current rent for full month
      const tenantResult = await pool.query(
        'SELECT rent_amount FROM tenants WHERE property_id = $1 AND status = $2',
        [propertyId, 'active']
      );

      const currentRent = tenantResult.rows[0]?.rent_amount || 0;
      
      return {
        month: monthYear,
        rent_amount: currentRent,
        prorated: false,
        changes: [],
        breakdown: [{
          from_date: monthStartStr,
          to_date: monthEndStr,
          rent_rate: currentRent,
          days: daysInMonth,
          amount: currentRent
        }]
      };
    }

    // Calculate prorated rent with changes
    let totalRent = 0;
    const breakdown = [];
    let currentDate = monthStart;
    
    // Get the rent BEFORE first change
    const firstChange = changesResult.rows[0];
    const firstChangeDate = new Date(firstChange.effective_date);
    const currentRentBefore = firstChange.old_rent || 0;

    // Calculate days before first change
    if (currentDate < firstChangeDate) {
      const daysBeforeChange = Math.ceil((firstChangeDate - currentDate) / (1000 * 60 * 60 * 24));
      const amountBeforeChange = (currentRentBefore / daysInMonth) * daysBeforeChange;
      totalRent += amountBeforeChange;

      breakdown.push({
        from_date: monthStartStr,
        to_date: firstChange.effective_date,
        rent_rate: currentRentBefore,
        days: daysBeforeChange,
        amount: amountBeforeChange
      });
    }

    // Calculate for each change period
    for (let i = 0; i < changesResult.rows.length; i++) {
      const change = changesResult.rows[i];
      const changeDate = new Date(change.effective_date);
      const nextChangeDate = i + 1 < changesResult.rows.length 
        ? new Date(changesResult.rows[i + 1].effective_date)
        : monthEnd;

      const daysAtRate = Math.ceil((nextChangeDate - changeDate) / (1000 * 60 * 60 * 24));
      const amountAtRate = (change.new_rent / daysInMonth) * daysAtRate;
      totalRent += amountAtRate;

      breakdown.push({
        from_date: change.effective_date,
        to_date: i + 1 < changesResult.rows.length 
          ? changesResult.rows[i + 1].effective_date 
          : monthEndStr,
        rent_rate: change.new_rent,
        days: daysAtRate,
        amount: amountAtRate,
        reason: change.reason
      });
    }

    return {
      month: monthYear,
      rent_amount: Math.round(totalRent * 100) / 100,  // Round to 2 decimals
      prorated: true,
      changes: changesResult.rows,
      breakdown
    };

  } catch (error) {
    console.error('Error calculating prorated rent:', error);
    throw error;
  }
}

/**
 * Generate bill with prorated rent (if applicable)
 */
async function generateBillWithProratedRent(propertyId, monthYear) {
  try {
    const billingService = require('./billingService');
    
    // Get electricity bill
    const electricityBill = await billingService.calculateElectricityBill(propertyId, monthYear);
    
    // Get prorated rent
    const rentInfo = await calculateRentForMonth(propertyId, monthYear);
    
    const baseRent = rentInfo.rent_amount;
    const totalDue = baseRent + electricityBill;

    return {
      month: monthYear,
      base_rent: baseRent,
      electricity_bill: electricityBill,
      total_due: totalDue,
      rent_prorated: rentInfo.prorated,
      rent_breakdown: rentInfo.breakdown
    };
  } catch (error) {
    console.error('Error generating bill with prorated rent:', error);
    throw error;
  }
}

/**
 * Update a rent change (correction/modification)
 */
async function updateRentChange(changeId, updateData) {
  const { new_rent, reason } = updateData;

  try {
    await pool.query(
      `UPDATE rent_history 
       SET new_rent = $1, reason = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [new_rent, reason, changeId]
    );

    return { success: true, changeId };
  } catch (error) {
    console.error('Error updating rent change:', error);
    throw error;
  }
}

/**
 * Delete a rent change (typically used for erroneous entries)
 */
async function deleteRentChange(changeId) {
  try {
    const result = await pool.query(
      'SELECT * FROM rent_history WHERE id = $1',
      [changeId]
    );

    if (result.rows.length === 0) {
      throw new Error('Rent change not found');
    }

    await pool.query('DELETE FROM rent_history WHERE id = $1', [changeId]);

    console.log(`[Rent Change] Deleted change ${changeId}`);
    return { success: true };
  } catch (error) {
    console.error('Error deleting rent change:', error);
    throw error;
  }
}

module.exports = {
  initializeRentHistoryTable,
  recordRentChange,
  getRentHistory,
  calculateRentForMonth,
  generateBillWithProratedRent,
  updateRentChange,
  deleteRentChange
};
