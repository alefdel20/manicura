const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// Nombre de variable distinto del DB_PATH de manicura — ambas bases de datos
// (manicura.db y dentista.db) conviven en el mismo volumen /app/data de este
// único backend, cada una con su propio archivo SQLite.
const DB_PATH = process.env.DENTISTA_DB_PATH || path.join(__dirname, '..', '..', 'data', 'dentista.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS dentistas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    especialidad TEXT,
    bio TEXT,
    activo INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS tratamientos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    precio INTEGER NOT NULL,
    duracion_minutos INTEGER NOT NULL,
    activo INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS dentista_tratamientos (
    dentista_id INTEGER NOT NULL REFERENCES dentistas(id) ON DELETE CASCADE,
    tratamiento_id INTEGER NOT NULL REFERENCES tratamientos(id) ON DELETE CASCADE,
    PRIMARY KEY (dentista_id, tratamiento_id)
  );

  -- Plantilla semanal por dentista (0=domingo..6=sábado, convención de
  -- Date.getDay()). Un día sin bloques activos es simplemente no disponible
  -- para ese dentista en cualquier futura ocurrencia de ese día de la semana.
  CREATE TABLE IF NOT EXISTS horarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dentista_id INTEGER NOT NULL REFERENCES dentistas(id) ON DELETE CASCADE,
    dia_semana INTEGER NOT NULL,
    inicio TEXT NOT NULL,
    fin TEXT NOT NULL,
    activo INTEGER NOT NULL DEFAULT 1
  );

  CREATE INDEX IF NOT EXISTS idx_horarios_dentista_dia ON horarios(dentista_id, dia_semana);

  -- Vacaciones / días fuera de la plantilla semanal para un dentista
  -- concreto — anulan su disponibilidad esa fecha sin tocar a los demás.
  CREATE TABLE IF NOT EXISTS dias_bloqueados (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dentista_id INTEGER NOT NULL REFERENCES dentistas(id) ON DELETE CASCADE,
    fecha_inicio TEXT NOT NULL,
    fecha_fin TEXT NOT NULL,
    motivo TEXT
  );

  -- Las citas guardan una "foto" del dentista y el tratamiento elegidos
  -- (nombre y precio al momento de agendar, además de sus ids), para que
  -- editar/desactivar un dentista o tratamiento después no altere el
  -- historial de citas ya guardado.
  CREATE TABLE IF NOT EXISTS citas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dentista_id INTEGER NOT NULL REFERENCES dentistas(id),
    dentista_nombre TEXT NOT NULL,
    fecha TEXT NOT NULL,
    bloque TEXT NOT NULL,
    nombre_paciente TEXT NOT NULL,
    telefono TEXT,
    tratamiento_id INTEGER,
    tratamiento_nombre TEXT,
    tratamiento_precio INTEGER,
    comentario TEXT,
    estado TEXT NOT NULL CHECK(estado IN ('pendiente','confirmada','expirada','cancelada')) DEFAULT 'pendiente',
    creada_en INTEGER NOT NULL,
    confirmada_en INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_citas_dentista_fecha_estado ON citas(dentista_id, fecha, estado);

  -- Cada admin es o bien la cuenta general de la clínica (rol='clinica',
  -- ve y da de alta todo) o la cuenta personal de un dentista (rol='dentista',
  -- ligada a un solo dentista_id, solo administra su propia agenda).
  CREATE TABLE IF NOT EXISTS admin (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    rol TEXT NOT NULL CHECK(rol IN ('clinica','dentista')) DEFAULT 'dentista',
    dentista_id INTEGER REFERENCES dentistas(id)
  );

  CREATE TABLE IF NOT EXISTS sesiones (
    id TEXT PRIMARY KEY,
    usuario TEXT NOT NULL,
    expira_en INTEGER NOT NULL
  );
`);

// Catálogo semilla de tratamientos de un consultorio general mixto, para que
// la clínica no arranque con la lista completamente vacía. Los dentistas se
// dan de alta manualmente desde el panel (no se inventa ninguno aquí).
const totalTratamientos = db.prepare('SELECT COUNT(*) AS n FROM tratamientos').get().n;
if (totalTratamientos === 0) {
  const insertar = db.prepare(
    'INSERT INTO tratamientos (nombre, precio, duracion_minutos, activo) VALUES (?, ?, ?, 1)'
  );
  db.transaction(() => {
    insertar.run('Consulta / revisión', 300, 30);
    insertar.run('Limpieza dental', 600, 45);
    insertar.run('Blanqueamiento dental', 1800, 60);
    insertar.run('Extracción simple', 900, 40);
    insertar.run('Ortodoncia — consulta inicial', 500, 40);
  })();
}

module.exports = db;
