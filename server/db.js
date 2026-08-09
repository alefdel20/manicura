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
`);

module.exports = db;
