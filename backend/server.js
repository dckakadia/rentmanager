process.env.TZ = 'Asia/Kolkata';
require('dotenv').config();

const pool = require('./src/config/database');
const { initializeDatabase } = require('./src/models/schema');
const { startSchedulers } = require('./src/schedulers/index');
const app = require('./app');

const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    await initializeDatabase();

    try {
      await pool.query('SELECT 1');
      console.log('Database connectivity verified');
    } catch (dbErr) {
      console.error('Database connectivity check failed:', dbErr);
      throw dbErr;
    }

    const server = app.listen(PORT, () => {
      console.log(`RentManager Backend running on port ${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV}`);
      console.log(`Timezone: ${process.env.TZ || 'not set'} | Server IST time: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
      console.log(`Node getHours(): ${new Date().getHours()} (should match current IST hour)`);
      console.log(`HA configured: ${Boolean(process.env.HA_SERVER_URL && process.env.HA_API_TOKEN)}`);
      startSchedulers();
    });

    process.on('SIGTERM', () => {
      console.log('SIGTERM signal received: closing HTTP server');
      server.close(() => {
        console.log('HTTP server closed');
        pool.end(() => {
          console.log('Database pool closed');
          process.exit(0);
        });
      });
    });
  } catch (err) {
    console.error('Fatal: Failed to start server due to DB error. Exiting.', err);
    process.exit(1);
  }
}

startServer();
