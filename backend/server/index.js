require('dotenv').config();

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const { seedAdmin } = require('./seed');
const publicRoutes = require('./routes/public');
const adminRoutes = require('./routes/admin');

// Demo de "dentista" (portafolio, ver dentista/README.md original) montada
// en este mismo servicio bajo /dentista y /api/dentista para no requerir un
// segundo despliegue en Dokploy — usa su propia base de datos SQLite, sus
// propias rutas y su propia cookie de sesión (ver server/dentista/).
const { seedAdmin: seedAdminDentista } = require('./dentista/seed');
const dentistaPublicRoutes = require('./dentista/routes/public');
const dentistaAdminRoutes = require('./dentista/routes/admin');

seedAdmin();
seedAdminDentista();

const app = express();
app.set('trust proxy', 1);

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const corsOptions = {
  origin(origin, callback) {
    // Sin Origin (curl, health checks, llamadas server-to-server) se permite.
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error(`Origen no permitido por CORS: ${origin}`));
  },
  credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());

app.get('/health', (req, res) => res.json({ ok: true }));

// Este servicio ya no sirve HTML/estáticos — solo responde /api/*.
// El sitio público y el panel admin viven en el servicio "frontend".
//
// Los mounts de /api/dentista van antes que los de /api "a secas" — no es
// estrictamente necesario (ningún router de manicura tiene una ruta que
// choque con /dentista/...), pero deja explícito que son namespaces
// independientes y evita cualquier ambigüedad si el router de manicura
// alguna vez gana una ruta comodín.
app.use('/api/dentista/admin', dentistaAdminRoutes);
app.use('/api/dentista', dentistaPublicRoutes);
app.use('/api', publicRoutes);
app.use('/api/admin', adminRoutes);

app.use((req, res) => {
  res.status(404).json({ ok: false, error: 'No encontrado' });
});

app.use((err, req, res, next) => {
  if (err && /CORS/.test(err.message)) {
    return res.status(403).json({ ok: false, error: 'Origen no permitido.' });
  }
  console.error(err);
  res.status(500).json({ ok: false, error: 'Error interno.' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API de Manicura corriendo en puerto ${PORT}`);
});
