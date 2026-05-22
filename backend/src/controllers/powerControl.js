const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const homeAssistant = require('../config/homeAssistant');

/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️  NC (NORMALLY CLOSED) RELAY WIRING — DO NOT CHANGE THIS LOGIC  ║
 * ║                                                                    ║
 * ║  Relay ON  = Power CUT   (tenant has NO electricity)               ║
 * ║  Relay OFF = Power FLOWING (tenant HAS electricity)                ║
 * ║                                                                    ║
 * ║  This is NOT a bug. Do not reverse the logic.                      ║
 * ║  — Devin Kakadia (Property Owner), 22 May 2026                     ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * In this controller:
 *   - homeAssistant.turnOn(propertyId)  → RESTORES tenant power (relay OFF)
 *   - homeAssistant.turnOff(propertyId) → CUTS tenant power    (relay ON)
 *
 * See homeAssistant.js for the full NC wiring explanation.
 */

async function getOverdueCutoffCandidates(settings, date = new Date()) {
  const currentDay = date.getDate();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const monthYear = `${year}-${month}`;
  const graceDays = settings?.cutoff_grace_days ?? 0;

  // 1) Primary: find overdue via rent_payments table (by month logic)
  const rpRes = await pool.query(`
      SELECT
        p.id,
        p.room_number,
        t.id as tenant_id,
        t.name,
        t.phone,
        MIN(rp.month_year) AS oldest_month_year,
        GROUP_CONCAT(rp.month_year, ', ') AS month_years,
        SUM(rp.total_due - COALESCE(rp.amount_paid, 0)) AS pending_amount
      FROM properties p
      JOIN tenants t ON p.id = t.property_id
      JOIN rent_payments rp ON p.id = rp.property_id
      WHERE p.is_occupied = 1
        AND t.skip_auto_cutoff = 0
        AND rp.payment_status IN ('pending', 'partial')
        AND (
          rp.month_year < $1
          OR 
          (rp.month_year = $1 AND $2 > (t.committed_payment_date + $3))
        )
      GROUP BY p.id, p.room_number, t.id, t.name, t.phone
      HAVING SUM(rp.total_due - COALESCE(rp.amount_paid, 0)) > 0
    `, [monthYear, currentDay, graceDays]);

  // BUG#3 FIX: Validate each row before adding to candidates
  const candidates = rpRes.rows
    .filter(row => {
      // Validate required fields
      if (!row.id || !row.tenant_id || !row.name) {
        console.warn(`[POWER CONTROL] Skipping invalid row:`, row);
        return false;
      }
      return true;
    })
    .map(row => ({
      property_id: row.id,
      tenant_id: row.tenant_id,
      room_number: row.room_number,
      tenant_name: row.name,
      phone: row.phone,
      month_year: row.month_years,
      pending_amount: row.pending_amount
    }));

  // 2) Fallback: include properties where the ledger running_balance > 0
  // This covers cases where transactions exist but rent_payments rows are missing.
  const ledgerRes = await pool.query(`
    SELECT p.id, p.room_number, t.id as tenant_id, t.name, t.phone,
      (SELECT running_balance FROM transactions WHERE tenant_id = t.id ORDER BY date DESC, id DESC LIMIT 1) as ledger_balance
    FROM properties p
    JOIN tenants t ON p.id = t.property_id
    WHERE p.is_occupied = 1
      AND t.skip_auto_cutoff = 0
      AND (SELECT running_balance FROM transactions WHERE tenant_id = t.id ORDER BY date DESC, id DESC LIMIT 1) > 0
  `);

  // BUG#3 FIX: Validate ledger results too
  for (const row of ledgerRes.rows) {
    if (!row.id || !row.tenant_id || !row.name) {
      console.warn(`[POWER CONTROL] Skipping invalid ledger row:`, row);
      continue;
    }
    // Skip if already present from rent_payments result
    if (!candidates.find(c => c.property_id === row.id)) {
      candidates.push({
        property_id: row.id,
        tenant_id: row.tenant_id,
        room_number: row.room_number,
        tenant_name: row.name,
        phone: row.phone,
        month_year: null,
        pending_amount: row.ledger_balance
      });
    }
  }

  return candidates;
}

/**
 * POST - Trigger immediate cutoff for all overdue payments
 * BUG#3 FIX: Complete validation before cutting power
 */
router.post('/trigger-cutoff', async (req, res) => {
  try {
    // BUG#3 FIX: Verify HA configuration before attempting cutoffs
    if (!process.env.HA_SERVER_URL || !process.env.HA_API_TOKEN) {
      return res.status(503).json({
        error: 'Home Assistant not configured',
        message: 'HA_SERVER_URL and HA_API_TOKEN must be set in environment'
      });
    }

    // 1. Get settings
    const settingsRes = await pool.query('SELECT * FROM settings WHERE id = 1');
    if (!settingsRes.rows[0]) {
      return res.status(500).json({ error: 'Settings not found' });
    }
    const settings = settingsRes.rows[0];

    // 2. Identify tenants who are past the grace period or simply unpaid
    const overdueCandidates = await getOverdueCutoffCandidates(settings);
    
    if (overdueCandidates.length === 0) {
      return res.json({
        success: true,
        count: 0,
        units: [],
        message: 'No overdue units found for cutoff'
      });
    }

    // BUG#3 FIX: Attempt cutoffs with individual transaction tracking
    const cutoffUnits = [];
    const failedCutoffs = [];
    
    for (const row of overdueCandidates) {
      try {
        const haResult = await homeAssistant.turnOff(row.property_id);
        
        if (!haResult.success) {
          failedCutoffs.push({
            property_id: row.property_id,
            room_number: row.room_number,
            tenant_name: row.tenant_name,
            reason: haResult.error || 'Unknown HA error'
          });
          continue;
        }

        // BUG#3 FIX: Only update DB if HA call succeeded
        await pool.query(
          'UPDATE properties SET power_status = 0, updated_at = datetime("now") WHERE id = $1',
          [row.property_id]
        );
        
        await pool.query(
          `INSERT INTO power_control_logs (property_id, action, triggered_by, reason, ha_response_status)
           VALUES ($1, 'OFF', 'SYSTEM', $2, 'success')`,
          [row.property_id, `Automatic cutoff: Unpaid balance ₹${row.pending_amount}, months: ${row.month_year || 'ledger'}`]
        );
        
        cutoffUnits.push({
          property_id: row.property_id,
          room_number: row.room_number,
          tenant_name: row.tenant_name,
          phone: row.phone,
          pending_amount: row.pending_amount,
          status: 'success'
        });
      } catch (error) {
        console.error(`[Power Control] Cutoff failed for property ${row.property_id}:`, error.message);
        failedCutoffs.push({
          property_id: row.property_id,
          room_number: row.room_number,
          tenant_name: row.tenant_name,
          reason: error.message
        });
      }
    }

    // After attempting cutoffs, perform a live sync with Home Assistant
    // to validate final states. Include the sync result in the response
    // so the frontend can display accurate hardware state immediately.
    let syncResult = { success: false, data: {} };
    try {
      syncResult = await homeAssistant.syncAllStates();
    } catch (e) {
      console.error('Error during post-cutoff HA sync:', e.message || e);
    }

    res.json({
      success: true,
      count: cutoffUnits.length,
      units: cutoffUnits,
      failed: failedCutoffs,
      failed_count: failedCutoffs.length,
      message: `Power cut off for ${cutoffUnits.length}/${overdueCandidates.length} units. ${failedCutoffs.length} failed.`,
      ha_sync: syncResult.data || {}
    });
  } catch (error) {
    console.error('Error in manual cutoff sweep:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET - Preview overdue cutoff candidates (SAFE: does not trigger any HA actions)
 * Returns the list of properties that would be considered for cutoff given current settings
 */
router.get('/overdue-candidates', async (req, res) => {
  try {
    const settingsRes = await pool.query('SELECT * FROM settings WHERE id = 1');
    const settings = settingsRes.rows[0] || {};

    const candidates = await getOverdueCutoffCandidates(settings);

    res.json({
      success: true,
      count: candidates.length,
      units: candidates
    });
  } catch (error) {
    console.error('Error fetching overdue candidates preview:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST - Turn ON power manually
 */
router.post('/:property_id/on', async (req, res) => {
  try {
    const { property_id } = req.params;
    const { reason = 'Manual control', retry_attempt } = req.body;
    const attemptNumber = Number.isInteger(retry_attempt) ? retry_attempt : null;

    const pid = parseInt(property_id, 10);
    if (isNaN(pid) || pid <= 0) return res.status(400).json({ error: 'Invalid property_id' });

    // Call Home Assistant to turn ON
    const haResult = await homeAssistant.turnOn(pid);

    // Log the action
    await pool.query(
      `INSERT INTO power_control_logs (property_id, action, triggered_by, reason, ha_response_status)
       VALUES ($1, $2, $3, $4, $5)`,
      [property_id, 'ON', 'MANUAL', reason, haResult.success ? 'success' : 'failed']
    );

    // Telemetry: record retry attempt if provided
    try {
      if (attemptNumber !== null) {
        await pool.query(
          `INSERT INTO power_control_retries (property_id, action, attempt_number, triggered_by, reason, error, success)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [property_id, 'ON', attemptNumber, 'RETRY', reason, haResult.success ? null : (haResult.error || null), haResult.success ? 1 : 0]
        );
      }
    } catch (e) {
      console.error('Failed to write retry telemetry (ON):', e.message || e);
    }

    if (!haResult.success) {
      return res.status(500).json({ error: 'Failed to control power', details: haResult.error });
    }

    // Update property power status in DB
    await pool.query(
      'UPDATE properties SET power_status = 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
      [pid]
    );

    res.json({ success: true, message: 'Power turned ON', action: 'ON' });
  } catch (error) {
    console.error('Error turning ON power:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST - Turn OFF power manually
 */
router.post('/:property_id/off', async (req, res) => {
  try {
    const { property_id } = req.params;
    const { reason = 'Manual control', retry_attempt } = req.body;
    const attemptNumber = Number.isInteger(retry_attempt) ? retry_attempt : null;

    const pid = parseInt(property_id, 10);
    if (isNaN(pid) || pid <= 0) return res.status(400).json({ error: 'Invalid property_id' });

    // Call Home Assistant to turn OFF
    const haResult = await homeAssistant.turnOff(pid);

    // Log the action
    await pool.query(
      `INSERT INTO power_control_logs (property_id, action, triggered_by, reason, ha_response_status)
       VALUES ($1, $2, $3, $4, $5)`,
      [property_id, 'OFF', 'MANUAL', reason, haResult.success ? 'success' : 'failed']
    );

    // Telemetry: record retry attempt if provided
    try {
      if (attemptNumber !== null) {
        await pool.query(
          `INSERT INTO power_control_retries (property_id, action, attempt_number, triggered_by, reason, error, success)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [property_id, 'OFF', attemptNumber, 'RETRY', reason, haResult.success ? null : (haResult.error || null), haResult.success ? 1 : 0]
        );
      }
    } catch (e) {
      console.error('Failed to write retry telemetry (OFF):', e.message || e);
    }

    if (!haResult.success) {
      return res.status(500).json({ error: 'Failed to control power', details: haResult.error });
    }

    // Update property power status in DB
    await pool.query(
      'UPDATE properties SET power_status = 0, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
      [pid]
    );

    res.json({ success: true, message: 'Power turned OFF', action: 'OFF' });
  } catch (error) {
    console.error('Error turning OFF power:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET - Get power control logs
 */
router.get('/logs/:property_id', async (req, res) => {
  try {
    const { property_id } = req.params;
    const result = await pool.query(
      'SELECT * FROM power_control_logs WHERE property_id = $1 ORDER BY created_at DESC LIMIT 20',
      [property_id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching power logs:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET - Get retry telemetry for a property
 */
router.get('/retries/:property_id', async (req, res) => {
  try {
    const { property_id } = req.params;
    const result = await pool.query(
      'SELECT * FROM power_control_retries WHERE property_id = $1 ORDER BY created_at DESC LIMIT 50',
      [property_id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching retry telemetry:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET - Get current status of all properties
 */
router.get('/', async (req, res) => {
  try {
    const result = await homeAssistant.syncAllStates();
    if (!result.success) {
      console.warn('Home Assistant unavailable during power status fetch:', result.error);
      return res.json([]);
    }

    // Get latest log for each property
    const statusMap = result.data;
    const response = [];

    for (const [propertyId, state] of Object.entries(statusMap)) {
      const propResult = await pool.query(
        'SELECT room_number, property_type FROM properties WHERE id = $1',
        [propertyId]
      );
      
      const logResult = await pool.query(
        'SELECT * FROM power_control_logs WHERE property_id = $1 ORDER BY created_at DESC LIMIT 1',
        [propertyId]
      );

      response.push({
        property_id: propertyId,
        room_number: propResult.rows[0]?.room_number || propertyId,
        property_type: propResult.rows[0]?.property_type || 'room',
        current_state: state,
        last_action: logResult.rows[0] || null,
      });
    }

    res.json(response);
  } catch (error) {
    console.error('Error fetching power status:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST - Test relay (Quick OFF-ON cycle)
 */
router.post('/:property_id/test', async (req, res) => {
  try {
    const { property_id } = req.params;
    const pid = parseInt(property_id, 10);
    if (isNaN(pid) || pid <= 0) return res.status(400).json({ error: 'Invalid property_id' });

    // 1. Turn OFF
    const offResult = await homeAssistant.turnOff(pid);
    if (!offResult.success) {
      return res.status(500).json({ error: 'Test failed at OFF stage', details: offResult.error });
    }

    // 2. Wait 3 seconds
    await new Promise(resolve => setTimeout(resolve, 3000));

    // 3. Turn ON
    const onResult = await homeAssistant.turnOn(parseInt(property_id));
    if (!onResult.success) {
      return res.status(500).json({ error: 'Test failed at ON stage', details: onResult.error });
    }

    // Log the test
    await pool.query(
      `INSERT INTO power_control_logs (property_id, action, triggered_by, reason, ha_response_status)
       VALUES ($1, $2, $3, $4, $5)`,
      [property_id, 'ON', 'MANUAL', 'Relay Test Cycle', 'success']
    );

    res.json({ success: true, message: 'Relay test cycle completed (OFF -> 3s -> ON)' });
  } catch (error) {
    console.error('Error testing relay:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
