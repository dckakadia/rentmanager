/**
 * Authentication Middleware
 * Basic token-based authentication to secure API endpoints
 */

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'default-admin-token-change-immediately';

/**
 * Verify JWT token
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

    // Verify token
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
 * Simple token validation (for admin token)
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
 * Optional authentication - for endpoints that work both with and without auth
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
    // On error, just continue without user (optional auth)
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
  verifyToken,
  verifyAdminToken,
  optionalAuth,
  generateToken,
  JWT_SECRET,
  ADMIN_TOKEN
};
