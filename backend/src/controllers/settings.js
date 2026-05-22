const express = require('express');
const router = express.Router();
const pool = require('../config/database');
require('dotenv').config();

/**
 * GET - Get current system settings and HA config
 */
router.get('/', async (req, res) => {
  try {
    // Fetch properties that have a linked relay
    const propertiesRes = await pool.query('SELECT id, room_number, ha_entity_id FROM properties');
    
    const relays = propertiesRes.rows
      .filter(p => p.ha_entity_id)
      .map(p => ({
        propertyId: p.id,
        roomNumber: p.room_number,
        entityId: p.ha_entity_id
      }));

    // Fetch system settings
    const settingsRes = await pool.query('SELECT * FROM settings WHERE id = 1');
    const settings = settingsRes.rows[0] || { 
      admin_name: 'Admin Owner', 
      admin_phone: '',
      auto_cutoff_enabled: 0,
      cutoff_grace_days: 4,
      cutoff_hour: 10,
      cutoff_notify_whatsapp: 1,
      cutoff_due_threshold: 1000,
      cutoff_date: '',
      cutoff_time: '23:00'
    };

    res.json({
      ha: {
        url: process.env.HA_SERVER_URL,
        token: '••••••••••••••••', 
        relays: relays.sort((a, b) => a.roomNumber.localeCompare(b.roomNumber))
      },
      system: {
        db_engine: 'SQLite',
        version: 'v1.0.4-stable',
        ...settings
      }
    });
  } catch (error) {
    console.error('Error fetching settings:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PATCH - Update system settings
 */
router.patch('/', async (req, res) => {
  try {
    const { 
      admin_name, 
      admin_phone,
      auto_cutoff_enabled,
      cutoff_grace_days,
      cutoff_hour,
      cutoff_notify_whatsapp,
      cutoff_due_threshold,
      cutoff_date,
      cutoff_time
    } = req.body;
    
    await pool.query(
      `UPDATE settings 
       SET admin_name = COALESCE($1, admin_name),
           admin_phone = COALESCE($2, admin_phone),
           auto_cutoff_enabled = COALESCE($3, auto_cutoff_enabled),
           cutoff_grace_days = COALESCE($4, cutoff_grace_days),
           cutoff_hour = COALESCE($5, cutoff_hour),
           cutoff_notify_whatsapp = COALESCE($6, cutoff_notify_whatsapp),
           cutoff_due_threshold = COALESCE($7, cutoff_due_threshold),
           cutoff_date = COALESCE($8, cutoff_date),
           cutoff_time = COALESCE($9, cutoff_time),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = 1`,
      [
        admin_name, 
        admin_phone, 
        auto_cutoff_enabled, 
        cutoff_grace_days, 
        cutoff_hour, 
        cutoff_notify_whatsapp,
        cutoff_due_threshold,
        cutoff_date,
        cutoff_time
      ]
    );

    const selectRes = await pool.query('SELECT * FROM settings WHERE id = 1');
    res.json(selectRes.rows[0]);
  } catch (error) {
    console.error('Error updating settings:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
