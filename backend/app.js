process.env.TZ = 'Asia/Kolkata';
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const propertiesRouter = require('./src/controllers/properties');
const tenantsRouter = require('./src/controllers/tenants');
const paymentsRouter = require('./src/controllers/payments');
const powerControlRouter = require('./src/controllers/powerControl');
const meterReadingsRouter = require('./src/controllers/meterReadings');
const dashboardRouter = require('./src/controllers/dashboard');
const backupRouter = require('./src/controllers/backup');
const settingsRouter = require('./src/controllers/settings');
const whatsappRouter = require('./src/controllers/whatsapp');
const diagnosticsRouter = require('./src/controllers/diagnostics');
const transactionsRouter = require('./src/controllers/transactions');
const billsRouter = require('./src/controllers/bills');

const { verifyAdminToken } = require('./src/middleware/auth');
const { errorHandler } = require('./src/middleware/validation');

const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

console.log('\n[INFO] API Authentication Status:');
console.log('- If ADMIN_TOKEN is set in environment: All endpoints require token');
console.log('- If ADMIN_TOKEN is not set: Using default token (CHANGE FOR PRODUCTION)');
console.log('- Set ADMIN_TOKEN in .env file for production security\n');

if (process.env.REQUIRE_AUTH === 'true') {
  app.use('/api/', verifyAdminToken);
  console.log('[SECURITY] API authentication ENABLED');
} else {
  console.log('[WARNING] API authentication DISABLED - for development only');
}

app.use('/api/properties', propertiesRouter);
app.use('/api/tenants', tenantsRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/power-control', powerControlRouter);
app.use('/api/meter-readings', meterReadingsRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/data', backupRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/whatsapp', whatsappRouter);
app.use('/api/diagnostics', diagnosticsRouter);
app.use('/api/transactions', transactionsRouter);
app.use('/api/bills', billsRouter);

app.use(express.static(path.join(__dirname, '../frontend/dist')));

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date() });
});

app.use(errorHandler);

app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
  }
});

module.exports = app;
