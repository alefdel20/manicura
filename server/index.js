require('dotenv').config();

const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');

const { seedAdmin } = require('./seed');
const { requireAdminPage } = require('./middleware/auth');
const publicRoutes = require('./routes/public');
const adminRoutes = require('./routes/admin');

seedAdmin();

const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use(cookieParser());

const ROOT = path.join(__dirname, '..');
const ADMIN_DIR = path.join(ROOT, 'admin');

// --- Sitio público ---
app.get('/', (req, res) => {
  res.sendFile(path.join(ROOT, 'index.html'));
});
app.use('/assets', express.static(path.join(ROOT, 'assets')));

// --- API ---
app.use('/api', publicRoutes);
app.use('/api/admin', adminRoutes);

// --- Panel admin ---
// login.html y dashboard.html se sirven explícitamente (nunca vía static)
// para que dashboard.html quede realmente protegido por requireAdminPage.
app.get('/admin/login', (req, res) => {
  res.sendFile(path.join(ADMIN_DIR, 'login.html'));
});
app.get('/admin', requireAdminPage, (req, res) => {
  res.sendFile(path.join(ADMIN_DIR, 'dashboard.html'));
});
app.use('/admin/assets', express.static(path.join(ADMIN_DIR, 'assets')));

app.use((req, res) => {
  res.status(404).send('No encontrado');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Manicura corriendo en puerto ${PORT}`);
});
