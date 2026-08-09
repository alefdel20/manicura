const bcrypt = require('bcryptjs');
const db = require('./db');

function seedAdmin() {
  const existente = db.prepare('SELECT id FROM admin LIMIT 1').get();
  if (existente) return false;

  const usuario = process.env.ADMIN_USER;
  const password = process.env.ADMIN_PASSWORD;

  if (!usuario || !password) {
    console.warn('[seed] ADMIN_USER / ADMIN_PASSWORD no definidos — no se creó cuenta admin.');
    return false;
  }

  const hash = bcrypt.hashSync(password, 10);
  db.prepare('INSERT INTO admin (usuario, password_hash) VALUES (?, ?)').run(usuario, hash);
  console.log(`[seed] Cuenta admin creada para usuario "${usuario}".`);
  return true;
}

if (require.main === module) {
  seedAdmin();
}

module.exports = { seedAdmin };
