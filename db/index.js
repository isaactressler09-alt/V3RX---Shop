const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const DB_DIR = process.env.DB_PATH || path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DB_DIR, 'v3rx.db');

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

console.log(`[DB] Storage path: ${DB_FILE}`);

let _db = null;

function saveDb() {
  const data = _db.export();
  fs.writeFileSync(DB_FILE, Buffer.from(data));
}

async function getDb() {
  if (_db) return _db;

  const SQL = await initSqlJs();

  if (fs.existsSync(DB_FILE)) {
    console.log('[DB] Loading existing database from disk');
    _db = new SQL.Database(fs.readFileSync(DB_FILE));
  } else {
    console.log('[DB] No database found, creating new one');
    _db = new SQL.Database();
  }

  _db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  _db.run(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      price REAL NOT NULL,
      description TEXT DEFAULT '',
      buy_link TEXT DEFAULT '',
      tags TEXT DEFAULT '[]',
      sizes TEXT DEFAULT '[]',
      variants TEXT DEFAULT '[]',
      images TEXT DEFAULT '[]',
      created_at INTEGER DEFAULT (strftime('%s','now')),
      updated_at INTEGER DEFAULT (strftime('%s','now'))
    );
  `);

  _db.run(`INSERT OR IGNORE INTO settings (key,value) VALUES ('store_name','V3RX')`);
  _db.run(`INSERT OR IGNORE INTO settings (key,value) VALUES ('store_tagline','Premium Streetwear')`);
  _db.run(`INSERT OR IGNORE INTO settings (key,value) VALUES ('admin_password','Fortnite2273!')`);

  saveDb();
  console.log('[DB] Ready');
  return _db;
}

function queryAll(db, sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function queryOne(db, sql, params = []) {
  return queryAll(db, sql, params)[0] || null;
}

function run(db, sql, params = []) {
  db.run(sql, params);
  saveDb(); // always flush to disk after every write
}

// Graceful shutdown — flush on exit
process.on('SIGTERM', () => { if (_db) saveDb(); process.exit(0); });
process.on('SIGINT',  () => { if (_db) saveDb(); process.exit(0); });

module.exports = { getDb, queryAll, queryOne, run, saveDb };
