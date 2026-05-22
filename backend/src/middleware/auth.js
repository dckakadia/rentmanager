/**
 * Authentication Middleware
 * Provides both cookie-based session auth (requireLogin) and
 * legacy token-based auth functions.
 */

const jwt = require('jsonwebtoken');

const COOKIE_NAME = 'rm_auth';
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'default-admin-token-change-immediately';

/**
 * requireLogin — Cookie-based session guard.
 * Protects all API routes. Returns 401 JSON when the session cookie is
 * missing or invalid so the frontend can redirect to /login.
 */
function requireLogin(req, res, next) {
  const token = req.cookies && req.cookies[COOKIE_NAME];

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Not logged in.' });
  }

  try {
    const secret = process.env.JWT_SECRET;
    const decoded = jwt.verify(token, secret);
    req.user = decoded;
    next();
  } catch (err) {
    // Clear expired/invalid cookie
    res.clearCookie(COOKIE_NAME, { path: '/' });
    return res.status(401).json({ error: 'Unauthorized', message: 'Session expired. Please log in again.' });
  }
}

/**
 * Verify JWT token (Bearer header — legacy)
 */
function verifyToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Missing authorization header'
      });
    }

    const token = authHeader.split(' ')[1]; // "Bearer token"

    if (!token) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid authorization format'
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: error.message
    });
  }
}

/**
 * Simple token validation (for admin token — legacy)
 */
function verifyAdminToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Missing authorization header'
      });
    }

    const token = authHeader.split(' ')[1]; // "Bearer token"

    if (token !== ADMIN_TOKEN) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid admin token'
      });
    }

    req.user = { role: 'admin' };
    next();
  } catch (error) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: error.message
    });
  }
}

/**
 * Optional authentication — for endpoints that work with and without auth
 */
function optionalAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      req.user = null;
      return next();
    }

    const token = authHeader.split(' ')[1];

    if (!token) {
      req.user = null;
      return next();
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    req.user = null;
    next();
  }
}

/**
 * Generate JWT token for authentication
 */
function generateToken(payload, expiresIn = '7d') {
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
}

module.exports = {
  requireLogin,
  verifyToken,
  verifyAdminToken,
  optionalAuth,
  generateToken,
  COOKIE_NAME,
  JWT_SECRET,
  ADMIN_TOKEN
};
