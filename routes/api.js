const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getDb, queryAll, queryOne, run } = require('../db');

// ---- Multer ----
const UPLOAD_DIR = process.env.UPLOAD_PATH || path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`)
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /jpeg|jpg|png|webp|gif/.test(path.extname(file.originalname).toLowerCase()))
});

function requireAuth(req, res, next) {
  if (req.session && req.session.admin) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

function parse(row) {
  if (!row) return null;
  return {
    ...row,
    tags: JSON.parse(row.tags || '[]'),
    sizes: JSON.parse(row.sizes || '[]'),
    variants: JSON.parse(row.variants || '[]'),
    images: JSON.parse(row.images || '[]')
  };
}

// ---- Auth ----
router.post('/auth/login', async (req, res) => {
  const db = await getDb();
  const row = queryOne(db, `SELECT value FROM settings WHERE key = 'admin_password'`);
  if (req.body.password === row?.value) {
    req.session.admin = true;
    res.json({ ok: true });
  } else {
    res.status(401).json({ error: 'Incorrect password' });
  }
});

router.post('/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

router.get('/auth/check', (req, res) => {
  res.json({ authenticated: !!(req.session && req.session.admin) });
});

// ---- Settings ----
router.get('/settings', async (req, res) => {
  const db = await getDb();
  const rows = queryAll(db, `SELECT key, value FROM settings WHERE key != 'admin_password'`);
  const result = {};
  rows.forEach(r => result[r.key] = r.value);
  res.json(result);
});

router.put('/settings', requireAuth, async (req, res) => {
  const db = await getDb();
  const { store_name, store_tagline, admin_password } = req.body;
  if (store_name) run(db, `INSERT INTO settings (key,value) VALUES ('store_name',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, [store_name]);
  if (store_tagline) run(db, `INSERT INTO settings (key,value) VALUES ('store_tagline',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, [store_tagline]);
  if (admin_password) run(db, `INSERT INTO settings (key,value) VALUES ('admin_password',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, [admin_password]);
  res.json({ ok: true });
});

// ---- Products ----
router.get('/products', async (req, res) => {
  const db = await getDb();
  res.json(queryAll(db, `SELECT * FROM products ORDER BY created_at DESC`).map(parse));
});

router.get('/products/:id', async (req, res) => {
  const db = await getDb();
  const row = queryOne(db, `SELECT * FROM products WHERE id = ?`, [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(parse(row));
});

router.post('/products', requireAuth, async (req, res) => {
  const { name, price, description, buy_link, tags, sizes, variants, images } = req.body;
  if (!name || !price) return res.status(400).json({ error: 'name and price required' });
  const db = await getDb();
  const id = uuidv4();
  run(db,
    `INSERT INTO products (id,name,price,description,buy_link,tags,sizes,variants,images) VALUES (?,?,?,?,?,?,?,?,?)`,
    [id, name, parseFloat(price), description||'', buy_link||'',
     JSON.stringify(tags||[]), JSON.stringify(sizes||[]),
     JSON.stringify(variants||[]), JSON.stringify(images||[])]
  );
  res.json(parse(queryOne(db, `SELECT * FROM products WHERE id = ?`, [id])));
});

router.put('/products/:id', requireAuth, async (req, res) => {
  const db = await getDb();
  const existing = queryOne(db, `SELECT * FROM products WHERE id = ?`, [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const { name, price, description, buy_link, tags, sizes, variants, images } = req.body;
  run(db,
    `UPDATE products SET name=?,price=?,description=?,buy_link=?,tags=?,sizes=?,variants=?,images=?,updated_at=strftime('%s','now') WHERE id=?`,
    [
      name ?? existing.name,
      price !== undefined ? parseFloat(price) : existing.price,
      description !== undefined ? description : existing.description,
      buy_link !== undefined ? buy_link : existing.buy_link,
      tags !== undefined ? JSON.stringify(tags) : existing.tags,
      sizes !== undefined ? JSON.stringify(sizes) : existing.sizes,
      variants !== undefined ? JSON.stringify(variants) : existing.variants,
      images !== undefined ? JSON.stringify(images) : existing.images,
      req.params.id
    ]
  );
  res.json(parse(queryOne(db, `SELECT * FROM products WHERE id = ?`, [req.params.id])));
});

router.delete('/products/:id', requireAuth, async (req, res) => {
  const db = await getDb();
  const existing = queryOne(db, `SELECT id FROM products WHERE id = ?`, [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  run(db, `DELETE FROM products WHERE id = ?`, [req.params.id]);
  res.json({ ok: true });
});

// ---- Upload ----
router.post('/upload', requireAuth, upload.array('images', 20), (req, res) => {
  res.json({ urls: req.files.map(f => `/uploads/${f.filename}`) });
});

module.exports = router;
