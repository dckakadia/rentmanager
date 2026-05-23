process.env.TZ = 'Asia/Kolkata';
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const cookieParser = require('cookie-parser');

const propertiesRouter = require('./src/controllers/properties');
const tenantsRouter = require('./src/controllers/tenants');
const paymentsRouter = require('./src/controllers/payments');
const { router: powerControlRouter } = require('./src/controllers/powerControl');
const meterReadingsRouter = require('./src/controllers/meterReadings');
const dashboardRouter = require('./src/controllers/dashboard');
const backupRouter = require('./src/controllers/backup');
const settingsRouter = require('./src/controllers/settings');
const whatsappRouter = require('./src/controllers/whatsapp');
const diagnosticsRouter = require('./src/controllers/diagnostics');
const transactionsRouter = require('./src/controllers/transactions');
const billsRouter = require('./src/controllers/bills');
const authController = require('./src/controllers/auth');

const { requireLogin } = require('./src/middleware/auth');
const { errorHandler } = require('./src/middleware/validation');

const app = express();

app.use(cors({ credentials: true, origin: true }));
app.use(cookieParser());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ── Public routes (no login required) ────────────────────────────────────────

// Auth endpoints: login, logout, me — always public (no requireLogin)
app.post('/api/auth/login', authController.login);
app.post('/api/auth/logout', authController.logout);
app.get('/api/auth/me', authController.me);

// Health check — always public
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date() });
});

// ── Protected routes (login required) ────────────────────────────────────────
// All /api/* routes below this line require a valid session cookie.

app.use('/api/', requireLogin);

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

// ── Static frontend & catch-all ───────────────────────────────────────────────

app.use(express.static(path.join(__dirname, '../frontend/dist')));

app.use(errorHandler);

// Catch-all: serve React app for any non-API path (React Router handles /login, /, etc.)
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
  }
});

module.exports = app;
