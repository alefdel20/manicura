const bcrypt = require('bcryptjs');
const db = require('./db');

// Crea la única cuenta "clínica" (administradora general) a partir de las
// variables de entorno. Desde esa cuenta se dan de alta los dentistas —
// cada uno con su propio usuario/password — desde el panel admin.
function seedAdmin() {
  const existente = db.prepare("SELECT id FROM admin WHERE rol = 'clinica' LIMIT 1").get();
  if (existente) return false;

  // Nombres de variable con prefijo DENTISTA_ — este proceso también seedea
  // la cuenta admin de manicura desde ADMIN_USER/ADMIN_PASSWORD "a secas",
  // así que hacen falta variables separadas para no pisarse entre sí.
  const usuario = process.env.DENTISTA_ADMIN_USER;
  const password = process.env.DENTISTA_ADMIN_PASSWORD;

  if (!usuario || !password) {
    console.warn('[seed] DENTISTA_ADMIN_USER / DENTISTA_ADMIN_PASSWORD no definidos — no se creó cuenta de clínica.');
    return false;
  }

  const hash = bcrypt.hashSync(password, 10);
  db.prepare("INSERT INTO admin (usuario, password_hash, rol, dentista_id) VALUES (?, ?, 'clinica', NULL)").run(
    usuario,
    hash
  );
  console.log(`[seed] Cuenta de clínica creada para usuario "${usuario}".`);
  return true;
}

if (require.main === module) {
  seedAdmin();
}

module.exports = { seedAdmin };
