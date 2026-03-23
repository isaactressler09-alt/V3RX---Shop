const express = require('express');
const session = require('express-session');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust Railway's proxy so secure cookies work over HTTPS
app.set('trust proxy', 1);

// ---- Middleware ----
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'v3rx-super-secret-change-this',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 24
  }
}));

// ---- Static files ----
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(
  process.env.UPLOAD_PATH || path.join(__dirname, 'public', 'uploads')
));

// ---- API Routes ----
app.use('/api', require('./routes/api'));

// ---- SPA fallback ----
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`V3RX server running on port ${PORT}`);
});
