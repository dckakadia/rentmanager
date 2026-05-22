/**
 * Auth Controller
 * Handles login, logout, and session check endpoints.
 * Credentials are read exclusively from environment variables — never hardcoded.
 */

const jwt = require('jsonwebtoken');

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Constant-time string comparison to prevent timing attacks.
 * Avoids leaking info about which character differed first.
 */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) {
    // Still do a compare so timing stays consistent
    let diff = 0;
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
    }
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// ── Cookie options ────────────────────────────────────────────────────────────

const COOKIE_NAME = 'rm_auth';

function getCookieOptions() {
  const sessionHours = parseInt(process.env.SESSION_HOURS || '24', 10);
  return {
    httpOnly: true,   // JS cannot read this cookie — XSS safe
    secure: false,    // HTTP-compatible (server runs without HTTPS on local network)
    sameSite: 'lax',  // Works for same-site navigation over HTTP
    maxAge: sessionHours * 60 * 60 * 1000,  // milliseconds
    path: '/',
  };
}

// ── Controllers ───────────────────────────────────────────────────────────────

/**
 * POST /api/auth/login
 * Body: { username, password }
 * Issues a signed JWT stored in an httpOnly cookie.
 */
async function login(req, res) {
  try {
    const { username, password } = req.body || {};

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    const expectedUsername = process.env.LOGIN_USERNAME;
    const expectedPassword = process.env.LOGIN_PASSWORD;

    if (!expectedUsername || !expectedPassword) {
      console.error('[AUTH] LOGIN_USERNAME or LOGIN_PASSWORD not set in .env');
      return res.status(500).json({ error: 'Server authentication not configured.' });
    }

    const usernameOk = safeEqual(username, expectedUsername);
    const passwordOk = safeEqual(password, expectedPassword);

    if (!usernameOk || !passwordOk) {
      // Generic message — don't reveal which field was wrong
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret || jwtSecret === 'your_jwt_secret_here') {
      console.error('[AUTH] JWT_SECRET is not set or is still the default placeholder.');
      return res.status(500).json({ error: 'Server authentication not configured.' });
    }

    const sessionHours = parseInt(process.env.SESSION_HOURS || '24', 10);
    const token = jwt.sign(
      { username: expectedUsername, role: 'admin' },
      jwtSecret,
      { expiresIn: `${sessionHours}h` }
    );

    res.cookie(COOKIE_NAME, token, getCookieOptions());

    return res.json({
      success: true,
      username: expectedUsername,
      message: 'Logged in successfully.',
    });
  } catch (err) {
    console.error('[AUTH] Login error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}

/**
 * POST /api/auth/logout
 * Clears the auth cookie.
 */
function logout(req, res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
  return res.json({ success: true, message: 'Logged out.' });
}

/**
 * GET /api/auth/me
 * Returns the current session state.
 * Used by the frontend ProtectedRoute to decide whether to redirect to /login.
 */
function me(req, res) {
  const token = req.cookies && req.cookies[COOKIE_NAME];

  if (!token) {
    return res.json({ loggedIn: false });
  }

  try {
    const jwtSecret = process.env.JWT_SECRET;
    const decoded = jwt.verify(token, jwtSecret);
    return res.json({ loggedIn: true, username: decoded.username });
  } catch {
    // Token expired or invalid
    res.clearCookie(COOKIE_NAME, { path: '/' });
    return res.json({ loggedIn: false });
  }
}

module.exports = { login, logout, me, COOKIE_NAME };
