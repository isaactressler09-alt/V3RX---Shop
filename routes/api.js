const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db');

// ---- Multer setup for image uploads ----
const UPLOAD_DIR = process.env.UPLOAD_PATH || path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp|gif/;
    cb(null, allowed.test(path.extname(file.originalname).toLowerCase()));
  }
});

// ---- Auth middleware ----
function requireAuth(req, res, next) {
  if (req.session && req.session.admin) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

// ---- Auth ----
router.post('/auth/login', (req, res) => {
  const { password } = req.body;
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'admin_password'`).get();
  if (password === row.value) {
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
router.get('/settings', (req, res) => {
  const rows = db.prepare(`SELECT key, value FROM settings WHERE key != 'admin_password'`).all();
  const result = {};
  rows.forEach(r => result[r.key] = r.value);
  res.json(result);
});

router.put('/settings', requireAuth, (req, res) => {
  const { store_name, store_tagline, admin_password } = req.body;
  const upsert = db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
  if (store_name) upsert.run('store_name', store_name);
  if (store_tagline) upsert.run('store_tagline', store_tagline);
  if (admin_password) upsert.run('admin_password', admin_password);
  res.json({ ok: true });
});

// ---- Products ----
router.get('/products', (req, res) => {
  const rows = db.prepare(`SELECT * FROM products ORDER BY created_at DESC`).all();
  res.json(rows.map(parseProduct));
});

router.get('/products/:id', (req, res) => {
  const row = db.prepare(`SELECT * FROM products WHERE id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(parseProduct(row));
});

router.post('/products', requireAuth, (req, res) => {
  const { name, price, description, buy_link, tags, sizes, variants, images } = req.body;
  if (!name || !price) return res.status(400).json({ error: 'name and price required' });
  const id = uuidv4();
  db.prepare(`
    INSERT INTO products (id, name, price, description, buy_link, tags, sizes, variants, images)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, parseFloat(price), description || '', buy_link || '',
    JSON.stringify(tags || []), JSON.stringify(sizes || []),
    JSON.stringify(variants || []), JSON.stringify(images || []));
  res.json(parseProduct(db.prepare(`SELECT * FROM products WHERE id = ?`).get(id)));
});

router.put('/products/:id', requireAuth, (req, res) => {
  const { name, price, description, buy_link, tags, sizes, variants, images } = req.body;
  const existing = db.prepare(`SELECT * FROM products WHERE id = ?`).get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  db.prepare(`
    UPDATE products SET
      name = ?, price = ?, description = ?, buy_link = ?,
      tags = ?, sizes = ?, variants = ?, images = ?,
      updated_at = unixepoch()
    WHERE id = ?
  `).run(
    name || existing.name,
    price !== undefined ? parseFloat(price) : existing.price,
    description !== undefined ? description : existing.description,
    buy_link !== undefined ? buy_link : existing.buy_link,
    tags !== undefined ? JSON.stringify(tags) : existing.tags,
    sizes !== undefined ? JSON.stringify(sizes) : existing.sizes,
    variants !== undefined ? JSON.stringify(variants) : existing.variants,
    images !== undefined ? JSON.stringify(images) : existing.images,
    req.params.id
  );
  res.json(parseProduct(db.prepare(`SELECT * FROM products WHERE id = ?`).get(req.params.id)));
});

router.delete('/products/:id', requireAuth, (req, res) => {
  const result = db.prepare(`DELETE FROM products WHERE id = ?`).run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

// ---- Image upload ----
router.post('/upload', requireAuth, upload.array('images', 20), (req, res) => {
  const urls = req.files.map(f => `/uploads/${f.filename}`);
  res.json({ urls });
});

function parseProduct(row) {
  return {
    ...row,
    tags: JSON.parse(row.tags || '[]'),
    sizes: JSON.parse(row.sizes || '[]'),
    variants: JSON.parse(row.variants || '[]'),
    images: JSON.parse(row.images || '[]')
  };
}

module.exports = router;
