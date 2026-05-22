const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const homeAssistant = require('../config/homeAssistant');

/**
 * GET - List available relays from HA (filtered by already linked ones)
 */
router.get('/relays/available', async (req, res) => {
  try {
    const haResult = await homeAssistant.getAvailableSwitches();
    if (!haResult.success) {
      console.warn('Home Assistant unavailable when fetching relays:', haResult.error);
      return res.json([]);
    }

    // Get currently linked relays from DB
    const dbResult = await pool.query('SELECT ha_entity_id FROM properties WHERE ha_entity_id IS NOT NULL');
    const linkedEntities = dbResult.rows.map(r => r.ha_entity_id);

    // Filter available relays
    const available = haResult.data.map(relay => ({
      ...relay,
      is_linked: linkedEntities.includes(relay.entity_id)
    }));

    res.json(available);
  } catch (error) {
    console.error('Error fetching available relays:', error);
    res.json([]);
  }
});

/**
 * PATCH - Link a relay to a property
 */
router.patch('/:id/link-relay', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) return res.status(400).json({ error: 'Invalid property id' });
    const { ha_entity_id } = req.body;

    if (!ha_entity_id) {
      return res.status(400).json({ error: 'ha_entity_id is required' });
    }

    // Safeguard: Check if this relay is already linked to ANOTHER property
    const checkResult = await pool.query(
      'SELECT id, room_number FROM properties WHERE ha_entity_id = $1 AND id != $2',
      [ha_entity_id, id]
    );

    if (checkResult.rows.length > 0) {
      return res.status(400).json({ 
        error: `Relay ${ha_entity_id} is already linked to ${checkResult.rows[0].room_number}. Please unlink it first.` 
      });
    }

    await pool.query(
      'UPDATE properties SET ha_entity_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [ha_entity_id, id]
    );

    const selectRes = await pool.query('SELECT * FROM properties WHERE id = $1', [id]);
    if (selectRes.rows.length === 0) {
      return res.status(404).json({ error: 'Property not found' });
    }

    res.json(selectRes.rows[0]);
  } catch (error) {
    console.error('Error linking relay:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PATCH - Unlink a relay from a property
 */
router.patch('/:id/unlink-relay', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) return res.status(400).json({ error: 'Invalid property id' });

    await pool.query(
      'UPDATE properties SET ha_entity_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
      [id]
    );

    const selectRes = await pool.query('SELECT * FROM properties WHERE id = $1', [id]);
    if (selectRes.rows.length === 0) {
      return res.status(404).json({ error: 'Property not found' });
    }

    res.json(selectRes.rows[0]);
  } catch (error) {
    console.error('Error unlinking relay:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET - List all properties
 */
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        p.*,
        t.id as tenant_id,
        t.name as tenant_name,
        t.phone as tenant_phone,
        t.rent_amount,
        t.committed_payment_date
      FROM properties p
      LEFT JOIN tenants t ON p.id = t.property_id
      ORDER BY p.room_number
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching properties:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET - Get single property details
 */
router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) return res.status(400).json({ error: 'Invalid property id' });
    const result = await pool.query(`
      SELECT 
        p.*,
        t.id as tenant_id,
        t.name as tenant_name,
        t.phone as tenant_phone,
        t.rent_amount,
        t.committed_payment_date,
        t.deposit_amount,
        t.deposit_date,
        t.rental_start_date
      FROM properties p
      LEFT JOIN tenants t ON p.id = t.property_id
      WHERE p.id = $1
    `, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Property not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching property:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST - Create new property
 */
router.post('/', async (req, res) => {
  try {
    const { property_type, room_number, meter_number } = req.body;
    
    if (!property_type || !room_number) {
      return res.status(400).json({ error: 'property_type and room_number are required' });
    }
    
    const insertRes = await pool.query(
      'INSERT INTO properties (property_type, room_number, meter_number) VALUES ($1, $2, $3)',
      [property_type, room_number, meter_number]
    );

    const selectRes = await pool.query('SELECT * FROM properties WHERE id = $1', [insertRes.lastID]);
    res.status(201).json(selectRes.rows[0]);
  } catch (error) {
    console.error('Error creating property:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PATCH - Update property occupancy
 */
router.patch('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) return res.status(400).json({ error: 'Invalid property id' });
    const { is_occupied, room_number, meter_number } = req.body;
    
    await pool.query(
      `UPDATE properties 
       SET is_occupied = COALESCE($1, is_occupied),
           room_number = COALESCE($2, room_number),
           meter_number = COALESCE($3, meter_number),
           updated_at = CURRENT_TIMESTAMP 
       WHERE id = $4`,
      [is_occupied, room_number, meter_number, id]
    );

    const selectRes = await pool.query('SELECT * FROM properties WHERE id = $1', [id]);
    if (selectRes.rows.length === 0) {
      return res.status(404).json({ error: 'Property not found' });
    }
    res.json(selectRes.rows[0]);
  } catch (error) {
    console.error('Error updating property:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE - Remove a property
 */
router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) return res.status(400).json({ error: 'Invalid property id' });
    
    // Check if property is occupied
    const checkRes = await pool.query('SELECT is_occupied FROM properties WHERE id = $1', [id]);
    if (checkRes.rows.length === 0) {
      return res.status(404).json({ error: 'Property not found' });
    }
    
    if (checkRes.rows[0].is_occupied) {
      return res.status(400).json({ error: 'Cannot delete occupied property. Please offboard tenant first.' });
    }
    
    await pool.query('DELETE FROM properties WHERE id = $1', [id]);
    res.json({ message: 'Property deleted successfully' });
  } catch (error) {
    console.error('Error deleting property:', error);
    let errorMessage = 'Failed to delete property.';
    if (error.message.includes('FOREIGN KEY constraint failed')) {
      errorMessage = 'Cannot delete property: It has linked records (readings, payments, or tenant history).';
    }
    res.status(500).json({ error: errorMessage, details: error.message });
  }
});

module.exports = router;
