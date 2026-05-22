const pool = require('../config/database');

/**
 * Initialize all database tables for SQLite
 */
async function initializeDatabase() {
  try {
    console.log('Initializing SQLite database schema...');

    // Migrations FIRST (to handle existing tables)
    try {
      await pool.query('ALTER TABLE properties ADD COLUMN meter_number TEXT');
      console.log('✓ Migration: Added meter_number to properties');
    } catch (e) {}

    try {
      await pool.query('ALTER TABLE settings ADD COLUMN auto_cutoff_enabled INTEGER DEFAULT 0');
      console.log('✓ Migration: Added auto_cutoff_enabled to settings table');
    } catch (e) {}
    try {
      await pool.query('ALTER TABLE settings ADD COLUMN cutoff_grace_days INTEGER DEFAULT 5');
      console.log('✓ Migration: Added cutoff_grace_days to settings table');
    } catch (e) {}
    try {
      await pool.query('ALTER TABLE settings ADD COLUMN cutoff_hour INTEGER DEFAULT 10');
      console.log('✓ Migration: Added cutoff_hour to settings table');
    } catch (e) {}
    try {
      await pool.query('ALTER TABLE settings ADD COLUMN cutoff_notify_whatsapp INTEGER DEFAULT 1');
      console.log('✓ Migration: Added cutoff_notify_whatsapp to settings table');
    } catch (e) {}
    try {
      await pool.query('ALTER TABLE settings ADD COLUMN cutoff_due_threshold INTEGER DEFAULT 1000');
      console.log('✓ Migration: Added cutoff_due_threshold to settings table');
    } catch (e) {}

    // Migration: create transactions table if it doesn't already exist (handled by CREATE TABLE IF NOT EXISTS below)

    // Properties table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS properties (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        property_type TEXT NOT NULL CHECK(property_type IN ('shop', 'room')),
        room_number TEXT UNIQUE NOT NULL,
        meter_number TEXT, -- Electricity meter ID
        ha_entity_id TEXT UNIQUE, 
        is_occupied INTEGER DEFAULT 0, -- Boolean 0/1
        power_status INTEGER DEFAULT 0, -- Boolean 0/1
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✓ Properties table created');

    // Tenants table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tenants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        property_id INTEGER NOT NULL UNIQUE REFERENCES properties(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        phone TEXT NOT NULL,
        rent_amount REAL NOT NULL,
        deposit_amount REAL DEFAULT 0,
        deposit_date TEXT,
        rental_start_date TEXT NOT NULL,
        committed_payment_date INTEGER DEFAULT 1,
        status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
        skip_auto_cutoff INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✓ Tenants table created');

    // Meter readings table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS meter_readings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
        reading_date TEXT NOT NULL,
        previous_reading REAL DEFAULT 0,
        current_reading REAL NOT NULL,
        units_consumed REAL,
        consumption_date INTEGER DEFAULT 10,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(property_id, reading_date)
      );
    `);
    console.log('✓ Meter Readings table created');

    // Rent payments table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS rent_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
        month_year TEXT NOT NULL,
        base_rent REAL NOT NULL,
        electricity_bill REAL DEFAULT 0,
        maintenance_share REAL DEFAULT 0,
        total_due REAL NOT NULL,
        amount_paid REAL DEFAULT 0,
        payment_date TEXT,
        payment_status TEXT DEFAULT 'pending' CHECK(payment_status IN ('pending', 'partial', 'paid')),
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(property_id, month_year)
      );
    `);
    console.log('✓ Rent Payments table created');

    // Payment corrections table (audit trail for payment adjustments)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS payment_corrections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        payment_id INTEGER NOT NULL REFERENCES rent_payments(id) ON DELETE CASCADE,
        old_amount REAL NOT NULL,
        new_amount REAL NOT NULL,
        reason TEXT,
        corrected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✓ Payment Corrections table created');

    // Maintenance expenses table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS maintenance_expenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        expense_date TEXT NOT NULL,
        description TEXT NOT NULL,
        amount REAL NOT NULL,
        month_year TEXT NOT NULL,
        expense_type TEXT DEFAULT 'common' CHECK(expense_type IN ('common', 'specific')),
        property_id INTEGER REFERENCES properties(id) ON DELETE SET NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✓ Maintenance Expenses table created');

    // Power control logs table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS power_control_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
        action TEXT NOT NULL CHECK(action IN ('ON', 'OFF')),
        triggered_by TEXT NOT NULL CHECK(triggered_by IN ('MANUAL', 'AUTO', 'SYSTEM')),
        reason TEXT,
        ha_response_status TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✓ Power Control Logs table created');

    // WhatsApp reminders table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS whatsapp_reminders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
        reminder_type TEXT NOT NULL CHECK(reminder_type IN ('rent_due', 'payment_confirmation', 'power_cutoff')),
        sent_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        status TEXT DEFAULT 'sent' CHECK(status IN ('sent', 'failed', 'pending')),
        message_content TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✓ WhatsApp Reminders table created');

    // Settings table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY CHECK (id = 1), -- Ensure only one row
        admin_name TEXT DEFAULT 'Admin Owner',
        admin_phone TEXT DEFAULT '',
        auto_cutoff_enabled INTEGER DEFAULT 0, -- Boolean 0/1
        cutoff_grace_days INTEGER DEFAULT 4,
        cutoff_hour INTEGER DEFAULT 10,
        cutoff_notify_whatsapp INTEGER DEFAULT 1,
        cutoff_due_threshold INTEGER DEFAULT 1000,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    // Initialize default settings if not exists
    await pool.query(`
      INSERT OR IGNORE INTO settings (id, admin_name, admin_phone, auto_cutoff_enabled, cutoff_grace_days, cutoff_hour, cutoff_notify_whatsapp, cutoff_due_threshold)
      VALUES (1, 'Admin Owner', '', 0, 4, 10, 1, 1000);
    `);
    console.log('✓ Settings table created and initialized');

    // Electricity meter config table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS electricity_meter_config (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        property_id INTEGER NOT NULL UNIQUE REFERENCES properties(id) ON DELETE CASCADE,
        meter_id TEXT,
        rate_per_unit REAL DEFAULT 9.00,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✓ Electricity Meter Config table created');

    // Indexes for performance
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_tenants_property_id ON tenants(property_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_meter_readings_property_id ON meter_readings(property_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_rent_payments_property_id ON rent_payments(property_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_rent_payments_month_year ON rent_payments(month_year);`);

    // Transactions table (running-balance ledger — one row per charge or payment)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('debit','credit','opening')),
        charge_type TEXT,   -- 'rent' | 'electricity' | 'other' (for debits)
        payment_mode TEXT,  -- 'cash' | 'phonepay' | 'bank' | 'cheque' (for credits)
        particulars TEXT NOT NULL,
        debit REAL DEFAULT 0,
        credit REAL DEFAULT 0,
        running_balance REAL NOT NULL DEFAULT 0,
        month_year TEXT,    -- YYYY-MM the charge/payment applies to
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_transactions_tenant_id ON transactions(tenant_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);`);
    console.log('✓ Transactions table created');
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_power_control_logs_property_id ON power_control_logs(property_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_whatsapp_reminders_property_id ON whatsapp_reminders(property_id);`);
    // Retry telemetry table for power control retries
    await pool.query(`
      CREATE TABLE IF NOT EXISTS power_control_retries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
        action TEXT NOT NULL CHECK(action IN ('ON','OFF')),
        attempt_number INTEGER NOT NULL,
        triggered_by TEXT NOT NULL CHECK(triggered_by IN ('MANUAL','AUTO','SYSTEM','RETRY')),
        reason TEXT,
        error TEXT,
        success INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_power_control_retries_property_id ON power_control_retries(property_id);`);
    
    console.log('✓ Indexes created');

    console.log('\n✅ SQLite Database initialization completed successfully!\n');
  } catch (error) {
    console.error('Error initializing SQLite database:', error);
    throw error;
  }
}

module.exports = { initializeDatabase };
