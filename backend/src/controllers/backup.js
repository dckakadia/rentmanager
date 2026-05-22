const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// Export all data to JSON
router.get('/export', async (req, res) => {
  try {
    const propertiesRes = await pool.query('SELECT * FROM properties');
    const tenantsRes = await pool.query('SELECT * FROM tenants');
    const paymentsRes = await pool.query('SELECT * FROM rent_payments');
    const readingsRes = await pool.query('SELECT * FROM meter_readings');
    const logsRes = await pool.query('SELECT * FROM power_control_logs');
    const expensesRes = await pool.query('SELECT * FROM maintenance_expenses');
    const remindersRes = await pool.query('SELECT * FROM whatsapp_reminders');
    const meterConfigRes = await pool.query('SELECT * FROM electricity_meter_config');

    const backup = {
      version: '1.2',
      timestamp: new Date().toISOString(),
      config: {
        ha_server_url: process.env.HA_SERVER_URL,
        relay_config: process.env.RELAY_CONFIG,
        reminder_time: process.env.REMINDER_TIME,
        cutoff_time: process.env.POWER_CUTOFF_TIME,
        sync_interval: process.env.SYNC_INTERVAL,
        timezone: process.env.TZ
      },
      data: {
        properties: propertiesRes.rows,
        tenants: tenantsRes.rows,
        payments: paymentsRes.rows,
        meterReadings: readingsRes.rows,
        powerLogs: logsRes.rows,
        maintenanceExpenses: expensesRes.rows,
        whatsappReminders: remindersRes.rows,
        electricityMeterConfig: meterConfigRes.rows
      }
    };

    res.json(backup);
  } catch (error) {
    console.error('Export failed:', error);
    res.status(500).json({ error: 'Failed to export data', details: error.message });
  }
});

// Import all data from JSON
router.post('/import', async (req, res) => {
  try {
    const { data } = req.body;
    if (!data) throw new Error('No data provided in request body');

    // Start manual transaction
    await pool.query('BEGIN TRANSACTION');

    // Disable foreign key constraints
    await pool.query('PRAGMA foreign_keys = OFF');

    // Clear existing data in correct order
    const tablesToClear = [
      'whatsapp_reminders',
      'power_control_logs',
      'meter_readings',
      'rent_payments',
      'maintenance_expenses',
      'tenants',
      'electricity_meter_config',
      'properties'
    ];

    for (const table of tablesToClear) {
      await pool.query(`DELETE FROM ${table}`);
    }

    // Import Helper
    const importItems = async (tableName, items) => {
      if (!items || items.length === 0) return;
      for (const item of items) {
        const keys = Object.keys(item);
        const placeholders = keys.map((_, i) => `$${i + 1}`).join(',');
        const values = Object.values(item);
        await pool.query(`INSERT INTO ${tableName} (${keys.join(',')}) VALUES (${placeholders})`, values);
      }
    };

    console.log('Importing core properties...');
    await importItems('properties', data.properties);
    
    console.log('Importing linked data...');
    await importItems('tenants', data.tenants);
    await importItems('rent_payments', data.payments);
    await importItems('meter_readings', data.meterReadings);
    await importItems('power_control_logs', data.powerLogs);
    await importItems('maintenance_expenses', data.maintenanceExpenses);
    await importItems('whatsapp_reminders', data.whatsappReminders);
    await importItems('electricity_meter_config', data.electricityMeterConfig);

    await pool.query('PRAGMA foreign_keys = ON');
    await pool.query('COMMIT');

    res.json({ message: 'Full system data imported successfully' });
  } catch (error) {
    await pool.query('ROLLBACK').catch(() => {});
    console.error('Import failed:', error);
    res.status(500).json({ error: 'Import failed: ' + error.message });
  }
});

module.exports = router;
