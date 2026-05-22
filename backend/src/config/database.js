const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '../../../database/rentmanager.db');

// Ensure the database directory exists
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error connecting to SQLite database:', err.message);
  } else {
    console.log('Connected to SQLite database at:', dbPath);
    db.run("PRAGMA foreign_keys = ON", (err) => {
      if (err) console.error('Error enabling foreign keys:', err.message);
      else console.log('✓ Foreign keys enabled');
    });
  }
});

// Better concurrency handling
try {
  db.configure('busyTimeout', 5000);
} catch (e) {
  // Older sqlite3 versions may not support configure
}

// Simple wrapper to mimic `pg` pool.query(text, params, cb)
const pool = {
  query: (text, paramsOrCb, cb) => {
    const maxRetries = 3;
    const retryDelay = 200; // ms

    let params = [];
    let callback = null;
    if (typeof paramsOrCb === 'function') {
      callback = paramsOrCb;
    } else {
      params = paramsOrCb || [];
      callback = cb;
    }

    // Convert $1, $2 placeholders to ? for sqlite
    const sqliteText = String(text).replace(/\$(\d+)/g, '?');

    const isSelect = /^\s*select/i.test(text);

    return new Promise((resolve, reject) => {
      const attemptAll = (attempt) => {
        db.all(sqliteText, params, (err, rows) => {
          if (err) {
            const isBusy = err && (err.code === 'SQLITE_BUSY' || /busy|locked/i.test(err.message || ''));
            if (isBusy && attempt < maxRetries) return setTimeout(() => attemptAll(attempt + 1), retryDelay);
            if (callback) callback(err);
            return reject(err);
          }
          const res = { rows };
          if (callback) callback(null, res);
          return resolve(res);
        });
      };

      const attemptRun = (attempt) => {
        db.run(sqliteText, params, function (err) {
          if (err) {
            const isBusy = err && (err.code === 'SQLITE_BUSY' || /busy|locked/i.test(err.message || ''));
            if (isBusy && attempt < maxRetries) return setTimeout(() => attemptRun(attempt + 1), retryDelay);
            if (callback) callback(err);
            return reject(err);
          }

          // For INSERT/UPDATE/DELETE we return basic meta. Attempt minimal RETURNING emulation for INSERTs.
          const res = { rows: [], lastID: this.lastID, changes: this.changes };

          // If caller asked for RETURNING *, try minimal emulation when possible (INSERT with numeric lastID)
          if (/\breturning\b/i.test(text) && this.lastID) {
            const tableMatch = sqliteText.match(/(?:INSERT INTO|UPDATE)\s+([a-zA-Z0-9_]+)/i);
            if (tableMatch) {
              const tableName = tableMatch[1];
              db.all(`SELECT * FROM ${tableName} WHERE id = ?`, [this.lastID], (err2, rows2) => {
                if (!err2) res.rows = rows2 || [];
                if (callback) callback(null, res);
                return resolve(res);
              });
              return;
            }
          }

          if (callback) callback(null, res);
          return resolve(res);
        });
      };

      // Dispatch
      if (isSelect) attemptAll(1);
      else attemptRun(1);
    });
  },
  on: () => {}
};

module.exports = pool;
