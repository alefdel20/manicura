const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'manicura.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS horarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    inicio TEXT NOT NULL,
    fin TEXT NOT NULL,
    activo INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS reservas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha TEXT NOT NULL,
    bloque TEXT NOT NULL,
    nombre_cliente TEXT NOT NULL,
    comentario TEXT,
    estado TEXT NOT NULL CHECK(estado IN ('pendiente','confirmada','expirada','cancelada')) DEFAULT 'pendiente',
    creada_en INTEGER NOT NULL,
    confirmada_en INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_reservas_fecha_estado ON reservas(fecha, estado);

  CREATE TABLE IF NOT EXISTS admin (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sesiones (
    id TEXT PRIMARY KEY,
    usuario TEXT NOT NULL,
    expira_en INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS servicios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    precio INTEGER NOT NULL,
    duracion_minutos INTEGER NOT NULL,
    activo INTEGER NOT NULL DEFAULT 1
  );
`);

function columnaExiste(tabla, columna) {
  return db.prepare(`PRAGMA table_info(${tabla})`).all().some((c) => c.name === columna);
}

// Los horarios ahora aplican por día de la semana (0=domingo..6=sábado, misma
// convención que Date.getDay()) en vez de a todos los días por igual. Los
// horarios ya cargados con el esquema viejo (sin día) se duplican de lunes a
// viernes para no perder la disponibilidad que ya estuviera configurada.
if (!columnaExiste('horarios', 'dia_semana')) {
  db.exec('ALTER TABLE horarios ADD COLUMN dia_semana INTEGER');

  const legado = db.prepare('SELECT * FROM horarios WHERE dia_semana IS NULL').all();
  const insertarCopia = db.prepare(
    'INSERT INTO horarios (inicio, fin, activo, dia_semana) VALUES (?, ?, ?, ?)'
  );
  const marcarLunes = db.prepare('UPDATE horarios SET dia_semana = 1 WHERE id = ?');

  db.transaction(() => {
    legado.forEach((h) => {
      [2, 3, 4, 5].forEach((dia) => insertarCopia.run(h.inicio, h.fin, h.activo, dia));
      marcarLunes.run(h.id);
    });
  })();
}

// Las reservas ahora guardan el teléfono de la clienta y una "foto" del
// servicio elegido (nombre y precio al momento de reservar, además del id),
// para que editar o borrar un servicio después no altere el historial.
['telefono', 'servicio_id', 'servicio_nombre', 'servicio_precio'].forEach((columna) => {
  if (!columnaExiste('reservas', columna)) {
    const tipo = columna === 'servicio_id' || columna === 'servicio_precio' ? 'INTEGER' : 'TEXT';
    db.exec(`ALTER TABLE reservas ADD COLUMN ${columna} ${tipo}`);
  }
});

// Seed único: si todavía no hay servicios cargados, se preserva el que antes
// vivía hardcodeado en el HTML para no perder el único servicio existente.
const totalServicios = db.prepare('SELECT COUNT(*) AS n FROM servicios').get().n;
if (totalServicios === 0) {
  db.prepare(
    'INSERT INTO servicios (nombre, precio, duracion_minutos, activo) VALUES (?, ?, ?, 1)'
  ).run('Uñas Esculturales', 350, 120);
}

module.exports = db;
