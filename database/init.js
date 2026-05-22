const pool = require('../backend/src/config/database');
const { initializeDatabase } = require('../backend/src/models/schema');

/**
 * Run database migrations and seed initial data
 */
async function runMigrations() {
  try {
    console.log('\n========================================');
    console.log('RentManager - Database Setup');
    console.log('========================================\n');

    // Initialize schema
    await initializeDatabase();

    // Seed initial properties (29 total: 9 shops + 20 rooms)
    console.log('\nSeeding initial properties...');

    // Create shops
    for (let i = 1; i <= 9; i++) {
      await pool.query(
        'INSERT INTO properties (property_type, room_number) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        ['shop', `S-${i.toString().padStart(2, '0')}`]
      );
    }
    console.log('✓ 9 Shops created');

    // Create rooms
    for (let i = 1; i <= 20; i++) {
      await pool.query(
        'INSERT INTO properties (property_type, room_number) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        ['room', `R-${i.toString().padStart(2, '0')}`]
      );
    }
    console.log('✓ 20 Rooms created');

    // Seed electricity meter config for all properties
    console.log('\nSeeding electricity meter configuration...');
    const properties = await pool.query('SELECT id FROM properties');
    for (const prop of properties.rows) {
      await pool.query(
        'INSERT INTO electricity_meter_config (property_id, meter_id, rate_per_unit) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [prop.id, `METER-${prop.id}`, 9.00]
      );
    }
    console.log(`✓ Meter config created for ${properties.rows.length} properties`);

    // Seed initial maintenance expenses
    console.log('\nSeeding initial maintenance expenses...');
    const currentMonth = new Date().toISOString().slice(0, 7);
    await pool.query(
      'INSERT INTO maintenance_expenses (expense_date, description, amount, month_year, expense_type) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING',
      [new Date().toISOString().split('T')[0], 'Sweeper salary', 2200, currentMonth, 'common']
    );
    console.log('✓ Initial maintenance expenses created');

    console.log('\n✅ Database setup completed successfully!');
    console.log('========================================\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error during database setup:', error);
    process.exit(1);
  }
}

// Run migrations
runMigrations();
