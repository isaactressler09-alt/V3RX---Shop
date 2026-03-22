const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'v3rx-secret-change-this';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'isaactressler09@gmail.com';
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || ''; // Set via env
const EMAIL_USER = process.env.EMAIL_USER || ''; // Your Gmail
const EMAIL_PASS = process.env.EMAIL_PASS || ''; // Gmail app password

// ─── IN-MEMORY STORE (replace with DB later) ──────────────────────────────────
const orders = [];
const verificationCodes = {}; // email -> { code, expires }
const inventory = {};         // productId -> { size -> stock }

// ─── EMAIL TRANSPORTER ────────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: EMAIL_USER, pass: EMAIL_PASS }
});

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function generateOrderId() {
  return 'V3RX-' + uuidv4().split('-')[0].toUpperCase();
}

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function authMiddleware(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'Forbidden' });
    req.admin = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// ─── ROUTES ───────────────────────────────────────────────────────────────────

// Send verification code to customer
app.post('/api/send-verification', async (req, res) => {
  const { email, firstName } = req.body;
  if (!email) return res.status(400).json({ success: false, error: 'Email required' });

  const code = generateCode();
  verificationCodes[email] = { code, expires: Date.now() + 10 * 60 * 1000 }; // 10 min

  try {
    await transporter.sendMail({
      from: `"V3RX Shop" <${EMAIL_USER}>`,
      to: email,
      subject: 'V3RX — Your Verification Code',
      html: `
        <div style="background:#080808;color:#f0ede8;padding:48px;font-family:monospace;max-width:500px;margin:0 auto;">
          <div style="font-size:2rem;font-weight:bold;letter-spacing:0.1em;margin-bottom:24px;">
            V3<span style="color:#c8ff00">RX</span>
          </div>
          <p style="color:#999;font-size:0.85rem;margin-bottom:24px;">Hey ${firstName || 'there'}, here's your verification code:</p>
          <div style="background:#111;border:1px solid #2a2a2a;padding:32px;text-align:center;margin-bottom:24px;">
            <div style="font-size:3rem;letter-spacing:0.4em;color:#c8ff00;font-weight:bold;">${code}</div>
            <div style="color:#555;font-size:0.7rem;margin-top:12px;letter-spacing:0.15em;">EXPIRES IN 10 MINUTES</div>
          </div>
          <p style="color:#555;font-size:0.75rem;line-height:1.7;">Enter this code on the V3RX checkout page to unlock your payment options.<br/>If you didn't request this, ignore this email.</p>
        </div>
      `
    });
    res.json({ success: true });
  } catch (err) {
    console.error('Email error:', err);
    // Still return success in dev so you can test without email
    res.json({ success: true, devCode: process.env.NODE_ENV !== 'production' ? code : undefined });
  }
});

// Verify code
app.post('/api/verify-code', (req, res) => {
  const { email, code } = req.body;
  const record = verificationCodes[email];
  if (!record) return res.json({ success: false, error: 'No code sent' });
  if (Date.now() > record.expires) return res.json({ success: false, error: 'Code expired' });
  if (record.code !== code) return res.json({ success: false, error: 'Wrong code' });
  delete verificationCodes[email];
  res.json({ success: true });
});

// Create order
app.post('/api/create-order', async (req, res) => {
  const { customer, product } = req.body;
  if (!customer || !product) return res.status(400).json({ success: false });

  const orderId = generateOrderId();
  const order = {
    orderId,
    customer,
    productId: product.id,
    productName: product.name,
    size: product.size,
    price: product.price,
    status: 'pending',
    trackingNumber: null,
    createdAt: new Date().toISOString(),
  };
  orders.push(order);

  // Email customer
  try {
    await transporter.sendMail({
      from: `"V3RX Shop" <${EMAIL_USER}>`,
      to: customer.email,
      subject: `V3RX — Order Confirmed ${orderId}`,
      html: `
        <div style="background:#080808;color:#f0ede8;padding:48px;font-family:monospace;max-width:500px;margin:0 auto;">
          <div style="font-size:2rem;font-weight:bold;letter-spacing:0.1em;margin-bottom:24px;">
            V3<span style="color:#c8ff00">RX</span>
          </div>
          <p style="color:#999;font-size:0.85rem;">Hey ${customer.firstName}, your order has been received!</p>
          <div style="background:#111;border:1px solid #2a2a2a;padding:24px;margin:24px 0;">
            <div style="color:#555;font-size:0.65rem;letter-spacing:0.2em;text-transform:uppercase;margin-bottom:8px;">Order ID</div>
            <div style="color:#c8ff00;font-size:1.4rem;letter-spacing:0.1em;">${orderId}</div>
          </div>
          <table style="width:100%;border-collapse:collapse;font-size:0.8rem;">
            <tr style="border-bottom:1px solid #2a2a2a;"><td style="padding:10px 0;color:#555;">Item</td><td style="color:#f0ede8;">${product.name}</td></tr>
            <tr style="border-bottom:1px solid #2a2a2a;"><td style="padding:10px 0;color:#555;">Size</td><td style="color:#f0ede8;">${product.size}</td></tr>
            <tr style="border-bottom:1px solid #2a2a2a;"><td style="padding:10px 0;color:#555;">Total</td><td style="color:#c8ff00;">$${product.price}</td></tr>
            <tr><td style="padding:10px 0;color:#555;">Ships To</td><td style="color:#f0ede8;">${customer.address1}, ${customer.city}, ${customer.state}</td></tr>
          </table>
          <p style="color:#555;font-size:0.75rem;margin-top:24px;line-height:1.7;">We'll verify your payment and get your order shipped within 3–5 business days. You can track your order at v3rx.com/track.html</p>
          <p style="color:#555;font-size:0.75rem;margin-top:12px;">Questions? DM us on TikTok @da.real.v3rx</p>
        </div>
      `
    });
  } catch (err) {
    console.error('Customer email failed:', err.message);
  }

  // Email admin
  try {
    await transporter.sendMail({
      from: `"V3RX Shop" <${EMAIL_USER}>`,
      to: ADMIN_EMAIL,
      subject: `🔔 New Order — ${orderId}`,
      html: `
        <div style="font-family:monospace;padding:24px;background:#080808;color:#f0ede8;">
          <h2 style="color:#c8ff00;">New Order Received</h2>
          <p><strong>Order ID:</strong> ${orderId}</p>
          <p><strong>Customer:</strong> ${customer.firstName} ${customer.lastName}</p>
          <p><strong>Email:</strong> ${customer.email}</p>
          <p><strong>Phone:</strong> ${customer.phone || '—'}</p>
          <p><strong>Item:</strong> ${product.name} — Size ${product.size}</p>
          <p><strong>Price:</strong> $${product.price}</p>
          <p><strong>Address:</strong> ${customer.address1}${customer.address2 ? ', ' + customer.address2 : ''}, ${customer.city}, ${customer.state} ${customer.zip}, ${customer.country}</p>
          <br/>
          <a href="https://yoursite.com/admin.html" style="background:#c8ff00;color:#000;padding:12px 20px;text-decoration:none;font-weight:bold;">Open Admin Panel</a>
        </div>
      `
    });
  } catch (err) {
    console.error('Admin email failed:', err.message);
  }

  res.json({ success: true, orderId });
});

// Track order (public)
app.get('/api/track-order', (req, res) => {
  const { orderId, email } = req.query;
  const order = orders.find(o => o.orderId === orderId && o.customer.email === email);
  if (!order) return res.json({ found: false });
  res.json({ found: true, order });
});

// ─── ADMIN ROUTES ─────────────────────────────────────────────────────────────

// Admin login
app.post('/api/admin/login', async (req, res) => {
  const { email, password } = req.body;
  if (email !== ADMIN_EMAIL) return res.json({ success: false });

  // In production, compare against hashed password from env
  const validPassword = ADMIN_PASSWORD_HASH
    ? await bcrypt.compare(password, ADMIN_PASSWORD_HASH)
    : password === (process.env.ADMIN_PASSWORD || 'v3rx-admin-2025'); // fallback for dev

  if (!validPassword) return res.json({ success: false });

  const token = jwt.sign({ email }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ success: true, token });
});

// Get all orders
app.get('/api/admin/orders', authMiddleware, (req, res) => {
  res.json({ orders: orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)) });
});

// Update order
app.patch('/api/admin/orders/:orderId', authMiddleware, async (req, res) => {
  const order = orders.find(o => o.orderId === req.params.orderId);
  if (!order) return res.status(404).json({ success: false });

  const { status, trackingNumber } = req.body;
  order.status = status || order.status;
  order.trackingNumber = trackingNumber || order.trackingNumber;
  order.updatedAt = new Date().toISOString();

  // Notify customer if shipped
  if (status === 'shipped') {
    try {
      await transporter.sendMail({
        from: `"V3RX Shop" <${EMAIL_USER}>`,
        to: order.customer.email,
        subject: `V3RX — Your Order Has Shipped! 📦`,
        html: `
          <div style="background:#080808;color:#f0ede8;padding:48px;font-family:monospace;max-width:500px;margin:0 auto;">
            <div style="font-size:2rem;font-weight:bold;letter-spacing:0.1em;margin-bottom:24px;">V3<span style="color:#c8ff00">RX</span></div>
            <p style="color:#c8ff00;font-size:1.1rem;">Your order is on its way! 🚀</p>
            <p style="color:#999;font-size:0.85rem;margin-top:12px;">Order ID: ${order.orderId}</p>
            <p style="color:#999;font-size:0.85rem;">Item: ${order.productName} — Size ${order.size}</p>
            ${trackingNumber ? `<p style="margin-top:16px;color:#f0ede8;">Tracking #: <strong style="color:#c8ff00">${trackingNumber}</strong></p>` : ''}
            <p style="color:#555;font-size:0.75rem;margin-top:24px;">Questions? DM us @da.real.v3rx on TikTok.</p>
          </div>
        `
      });
    } catch (err) {
      console.error('Shipped email failed:', err.message);
    }
  }

  res.json({ success: true, order });
});

// Get inventory
app.get('/api/admin/inventory', authMiddleware, (req, res) => {
  res.json({ inventory });
});

// Save inventory
app.post('/api/admin/inventory', authMiddleware, (req, res) => {
  const { productId, stock } = req.body;
  inventory[productId] = stock;
  res.json({ success: true });
});

// Catch-all for SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`V3RX backend running on port ${PORT}`));
