const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const billingService = require('../services/billingService');

/**
 * POST - Record meter reading
 * BUG#2 & BUG#5 FIX: Detect meter resets, handle conflicts
 */
router.post('/', async (req, res) => {
  try {
    const { property_id, current_reading, reading_date = new Date().toISOString().split('T')[0] } = req.body;

    if (!property_id || current_reading === undefined) {
      return res.status(400).json({ error: 'property_id and current_reading are required' });
    }

    // BUG#5 FIX: Validate current_reading is non-negative
    if (typeof current_reading !== 'number' || current_reading < 0) {
      return res.status(400).json({
        error: 'Validation Error',
        details: [{ field: 'current_reading', message: 'Must be a non-negative number' }]
      });
    }

    // BUG#2 FIX: Check if reading already exists
    const existingRes = await pool.query(
      `SELECT id, current_reading FROM meter_readings 
       WHERE property_id = $1 AND reading_date = $2`,
      [property_id, reading_date]
    );

    if (existingRes.rows.length > 0) {
      const existing = existingRes.rows[0];
      return res.status(409).json({
        error: 'Reading already exists for this date',
        message: `Meter already has reading on ${reading_date} with value ${existing.current_reading}. Please update or delete and re-enter.`,
        existing_id: existing.id,
        existing_reading: existing.current_reading,
        status_code: 409
      });
    }

    // Get previous reading (latest reading BEFORE the current entry date)
    const prevResult = await pool.query(
      `SELECT current_reading, reading_date FROM meter_readings 
       WHERE property_id = $1 AND reading_date < $2
       ORDER BY reading_date DESC 
       LIMIT 1`,
      [property_id, reading_date]
    );

    const previousReading = prevResult.rows.length > 0 ? prevResult.rows[0].current_reading : 0;
    let unitsConsumed = current_reading - previousReading;

    // BUG#5 FIX: Detect and handle meter reset
    if (unitsConsumed < 0) {
      console.warn(`[METER] Meter reset detected for property ${property_id}: ${previousReading} → ${current_reading}`);
      
      return res.status(400).json({
        error: 'Meter Reset Detected',
        message: `Meter appears to have been reset or replaced. Previous reading: ${previousReading}, Current: ${current_reading}`,
        previous_reading: previousReading,
        current_reading: current_reading,
        suggestion: 'If meter was physically replaced, update the meter_number property first, then retry.'
      });
    }

    const rate = 9; // ₹9 per unit
    const electricityBill = unitsConsumed * rate;

    // Save meter reading (Safe INSERT without REPLACE)
    const insertRes = await pool.query(
      `INSERT INTO meter_readings 
       (property_id, reading_date, previous_reading, current_reading, units_consumed)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [property_id, reading_date, previousReading, current_reading, unitsConsumed]
    );

    const savedReading = insertRes.rows[0];

    // DISABLED: Automatic bill generation
    // Bills are now generated manually via Bill Generation page
    // const prevMonthYear = billingService.getPreviousMonthYear();
    // await billingService.generateOrUpdateBill(property_id, prevMonthYear);

    res.status(201).json({
      ...savedReading,
      electricity_bill: electricityBill,
      rate_per_unit: rate,
    });
  } catch (error) {
    console.error('Error recording meter reading:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET - Latest meter reading
 */
router.get('/latest/:property_id', async (req, res) => {
  try {
    const property_id = parseInt(req.params.property_id, 10);
    if (isNaN(property_id) || property_id <= 0) return res.status(400).json({ error: 'Invalid property id' });

    const result = await pool.query(
      `SELECT * FROM meter_readings 
       WHERE property_id = $1 
       ORDER BY reading_date DESC 
       LIMIT 1`,
      [property_id]
    );

    if (result.rows.length === 0) {
      return res.json({ message: 'No meter readings found' });
    }

    const reading = result.rows[0];
    res.json({
      ...reading,
      electricity_bill: reading.units_consumed * 9,
    });
  } catch (error) {
    console.error('Error fetching latest meter reading:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET - Latest readings for all properties (Bulk View)
 */
router.get('/all/latest', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        p.id,
        p.room_number,
        p.property_type,
        p.meter_number,
        t.name as tenant_name,
        mr.current_reading as last_reading,
        mr.reading_date as last_reading_date,
        (
          SELECT GROUP_CONCAT(current_reading || '|' || reading_date)
          FROM (
            SELECT current_reading, reading_date
            FROM meter_readings
            WHERE property_id = p.id
            ORDER BY reading_date DESC
            LIMIT 4
          )
        ) as recent_readings
      FROM properties p
      LEFT JOIN tenants t ON p.id = t.property_id AND t.status = 'active'
      LEFT JOIN (
        SELECT property_id, current_reading, reading_date,
               ROW_NUMBER() OVER (PARTITION BY property_id ORDER BY reading_date DESC) as rn
        FROM meter_readings
      ) mr ON p.id = mr.property_id AND mr.rn = 1
      ORDER BY p.room_number
    `);

    const formattedRows = result.rows.map(row => {
      let history = [];
      if (row.recent_readings) {
        history = row.recent_readings.split(',').map(item => {
          const [reading, date] = item.split('|');
          return { reading: parseFloat(reading), date };
        });
      }
      return { ...row, history };
    });

    res.json(formattedRows);
  } catch (error) {
    console.error('Error fetching all latest readings:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET - Meter reading history for a property
 */
router.get('/:property_id', async (req, res) => {
  try {
    const property_id = parseInt(req.params.property_id, 10);
    if (isNaN(property_id) || property_id <= 0) return res.status(400).json({ error: 'Invalid property id' });
    const limit = Math.max(1, parseInt(req.query.limit || '12', 10));

    const result = await pool.query(
      `SELECT * FROM meter_readings 
       WHERE property_id = $1 
       ORDER BY reading_date DESC 
       LIMIT $2`,
      [property_id, limit]
    );

    // Add calculated electricity bills
    const readings = result.rows.map(reading => ({
      ...reading,
      electricity_bill: reading.units_consumed * 9,
    }));

    res.json(readings);
  } catch (error) {
    console.error('Error fetching meter readings:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT - Update an existing reading
 */
router.put('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) return res.status(400).json({ error: 'Invalid reading id' });
    const { current_reading, reading_date } = req.body;

    if (current_reading === undefined) {
      return res.status(400).json({ error: 'current_reading is required' });
    }

    // Get the reading to find the property_id
    const readingRes = await pool.query('SELECT property_id FROM meter_readings WHERE id = $1', [id]);
    if (readingRes.rows.length === 0) {
      return res.status(404).json({ error: 'Reading not found' });
    }
    const { property_id } = readingRes.rows[0];

    // Use provided reading_date or fallback to existing reading's date
    const targetReadingDate = reading_date || readingRes.rows[0].reading_date;

    // Get previous reading
    const prevResult = await pool.query(
      `SELECT current_reading FROM meter_readings 
       WHERE property_id = $1 AND reading_date < $2
       ORDER BY reading_date DESC 
       LIMIT 1`,
      [property_id, targetReadingDate]
    );

    const previousReading = prevResult.rows.length > 0 ? prevResult.rows[0].current_reading : 0;
    const unitsConsumed = current_reading - previousReading;

    await pool.query(
      `UPDATE meter_readings 
       SET current_reading = $1, reading_date = $2, previous_reading = $3, units_consumed = $4, updated_at = CURRENT_TIMESTAMP
       WHERE id = $5`,
      [current_reading, reading_date, previousReading, unitsConsumed, id]
    );

    // Update subsequent readings' previous_reading (select next id then update to avoid unsupported UPDATE ORDER/LIMIT)
    const nextRes = await pool.query(
      `SELECT id FROM meter_readings WHERE property_id = $1 AND reading_date > $2 ORDER BY reading_date ASC LIMIT 1`,
      [property_id, targetReadingDate]
    );
    if (nextRes.rows.length > 0) {
      await pool.query(
        `UPDATE meter_readings 
         SET previous_reading = $1, units_consumed = current_reading - $1
         WHERE id = $2`,
        [current_reading, nextRes.rows[0].id]
      );
    }

    res.json({ message: 'Reading updated successfully' });
  } catch (error) {
    console.error('Error updating meter reading:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE - Remove a reading
 */
router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) return res.status(400).json({ error: 'Invalid reading id' });
    
    // Get info before deleting to update subsequent readings
    const readingRes = await pool.query('SELECT property_id, reading_date, previous_reading FROM meter_readings WHERE id = $1', [id]);
    if (readingRes.rows.length === 0) {
      return res.status(404).json({ error: 'Reading not found' });
    }
    const { property_id, reading_date, previous_reading } = readingRes.rows[0];

    await pool.query('DELETE FROM meter_readings WHERE id = $1', [id]);

    // Update subsequent reading's previous_reading to bridge the gap (select next id then update)
    const nextAfterDelete = await pool.query(
      `SELECT id FROM meter_readings WHERE property_id = $1 AND reading_date > $2 ORDER BY reading_date ASC LIMIT 1`,
      [property_id, reading_date]
    );
    if (nextAfterDelete.rows.length > 0) {
      await pool.query(
        `UPDATE meter_readings 
         SET previous_reading = $1, units_consumed = current_reading - $1
         WHERE id = $2`,
        [previous_reading, nextAfterDelete.rows[0].id]
      );
    }

    res.json({ message: 'Reading deleted successfully' });
  } catch (error) {
    console.error('Error deleting meter reading:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
