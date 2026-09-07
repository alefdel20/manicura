const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const {
  crearSesion,
  destruirSesion,
  requireAdminApi,
  requireClinica,
  puedeAdministrarDentista,
} = require('../middleware/auth');
const { expirarPendientesVencidas } = require('../lib/expiracion');
const { horaAMinutos } = require('../lib/horas');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Demasiados intentos. Intenta de nuevo más tarde.' },
});

router.post('/login', loginLimiter, (req, res) => {
  const { usuario, password } = req.body || {};
  if (!usuario || !password) {
    return res.status(400).json({ ok: false, error: 'Usuario y password requeridos.' });
  }

  const cuenta = db.prepare('SELECT * FROM admin WHERE usuario = ?').get(usuario);
  if (!cuenta || !bcrypt.compareSync(password, cuenta.password_hash)) {
    return res.status(401).json({ ok: false, error: 'Usuario o password incorrectos.' });
  }

  crearSesion(res, cuenta.usuario);
  res.json({ ok: true });
});

router.post('/logout', (req, res) => {
  destruirSesion(req, res);
  res.json({ ok: true });
});

router.use(requireAdminApi);

// El panel muestra pestañas distintas según el rol — la clínica administra
// todo, un dentista solo su propia agenda — por eso el frontend arranca
// preguntando quién inició sesión.
router.get('/me', (req, res) => {
  let dentista = null;
  if (req.admin.dentista_id) {
    dentista = db.prepare('SELECT id, nombre, especialidad FROM dentistas WHERE id = ?').get(req.admin.dentista_id);
  }
  res.json({ ok: true, usuario: req.admin.usuario, rol: req.admin.rol, dentista });
});

// --- Dentistas (alta/edición: clínica; un dentista puede editar su propio perfil) ---

router.get('/dentistas', requireClinica, (req, res) => {
  const dentistas = db.prepare('SELECT * FROM dentistas ORDER BY nombre').all();
  res.json({ ok: true, dentistas });
});

router.post('/dentistas', requireClinica, (req, res) => {
  const { nombre, especialidad, bio, usuario, password } = req.body || {};
  const nombreLimpio = typeof nombre === 'string' ? nombre.trim() : '';
  const especialidadLimpia = typeof especialidad === 'string' ? especialidad.trim().slice(0, 100) : '';
  const bioLimpia = typeof bio === 'string' ? bio.trim().slice(0, 500) : '';
  const usuarioLimpio = typeof usuario === 'string' ? usuario.trim() : '';

  if (!nombreLimpio || nombreLimpio.length > 100) {
    return res.status(400).json({ ok: false, error: 'Escribe el nombre del dentista.' });
  }
  if (!usuarioLimpio || usuarioLimpio.length > 40) {
    return res.status(400).json({ ok: false, error: 'Escribe un usuario para su acceso.' });
  }
  if (typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ ok: false, error: 'La contraseña debe tener al menos 6 caracteres.' });
  }

  const usuarioExistente = db.prepare('SELECT id FROM admin WHERE usuario = ?').get(usuarioLimpio);
  if (usuarioExistente) {
    return res.status(409).json({ ok: false, error: 'Ese usuario ya existe — elige otro.' });
  }

  const dentista = db.transaction(() => {
    const info = db
      .prepare('INSERT INTO dentistas (nombre, especialidad, bio, activo) VALUES (?, ?, ?, 1)')
      .run(nombreLimpio, especialidadLimpia || null, bioLimpia || null);
    const hash = bcrypt.hashSync(password, 10);
    db.prepare(
      "INSERT INTO admin (usuario, password_hash, rol, dentista_id) VALUES (?, ?, 'dentista', ?)"
    ).run(usuarioLimpio, hash, info.lastInsertRowid);
    return db.prepare('SELECT * FROM dentistas WHERE id = ?').get(info.lastInsertRowid);
  })();

  res.status(201).json({ ok: true, dentista });
});

router.patch('/dentistas/:id', (req, res) => {
  const existente = db.prepare('SELECT * FROM dentistas WHERE id = ?').get(req.params.id);
  if (!existente) {
    return res.status(404).json({ ok: false, error: 'Dentista no encontrado.' });
  }
  if (!puedeAdministrarDentista(req.admin, existente.id)) {
    return res.status(403).json({ ok: false, error: 'No puedes editar el perfil de otro dentista.' });
  }

  const { nombre, especialidad, bio, activo } = req.body || {};
  const nombreLimpio = typeof nombre === 'string' && nombre.trim() ? nombre.trim().slice(0, 100) : existente.nombre;
  const especialidadLimpia =
    typeof especialidad === 'string' ? especialidad.trim().slice(0, 100) : existente.especialidad;
  const bioLimpia = typeof bio === 'string' ? bio.trim().slice(0, 500) : existente.bio;
  // Solo la clínica puede desactivar/reactivar a un dentista (le quita
  // la visibilidad pública), un dentista no puede auto-desactivarse.
  const activoFinal =
    req.admin.rol === 'clinica' && typeof activo === 'boolean' ? (activo ? 1 : 0) : existente.activo;

  db.prepare('UPDATE dentistas SET nombre = ?, especialidad = ?, bio = ?, activo = ? WHERE id = ?').run(
    nombreLimpio,
    especialidadLimpia,
    bioLimpia,
    activoFinal,
    req.params.id
  );
  const dentista = db.prepare('SELECT * FROM dentistas WHERE id = ?').get(req.params.id);
  res.json({ ok: true, dentista });
});

router.delete('/dentistas/:id', requireClinica, (req, res) => {
  const existente = db.prepare('SELECT * FROM dentistas WHERE id = ?').get(req.params.id);
  if (!existente) {
    return res.status(404).json({ ok: false, error: 'Dentista no encontrado.' });
  }

  // Las citas ya hechas conservan su "foto" del dentista (dentista_nombre),
  // así que borrar el perfil y su acceso no rompe el historial de citas.
  db.transaction(() => {
    db.prepare('DELETE FROM admin WHERE dentista_id = ?').run(req.params.id);
    db.prepare('DELETE FROM dentistas WHERE id = ?').run(req.params.id);
  })();

  res.json({ ok: true });
});

// Qué tratamientos del catálogo ofrece cada dentista.

router.get('/dentistas/:id/tratamientos', (req, res) => {
  const dentistaId = Number(req.params.id);
  if (!puedeAdministrarDentista(req.admin, dentistaId)) {
    return res.status(403).json({ ok: false, error: 'No autorizado.' });
  }
  const ids = db
    .prepare('SELECT tratamiento_id FROM dentista_tratamientos WHERE dentista_id = ?')
    .all(dentistaId)
    .map((r) => r.tratamiento_id);
  res.json({ ok: true, tratamiento_ids: ids });
});

router.put('/dentistas/:id/tratamientos', (req, res) => {
  const dentistaId = Number(req.params.id);
  if (!puedeAdministrarDentista(req.admin, dentistaId)) {
    return res.status(403).json({ ok: false, error: 'No autorizado.' });
  }
  const dentista = db.prepare('SELECT id FROM dentistas WHERE id = ?').get(dentistaId);
  if (!dentista) {
    return res.status(404).json({ ok: false, error: 'Dentista no encontrado.' });
  }

  const { tratamiento_ids: tratamientoIds } = req.body || {};
  if (!Array.isArray(tratamientoIds)) {
    return res.status(400).json({ ok: false, error: 'Lista de tratamientos inválida.' });
  }
  const idsValidos = tratamientoIds.map(Number).filter((n) => Number.isInteger(n) && n > 0);

  db.transaction(() => {
    db.prepare('DELETE FROM dentista_tratamientos WHERE dentista_id = ?').run(dentistaId);
    const insertar = db.prepare(
      'INSERT OR IGNORE INTO dentista_tratamientos (dentista_id, tratamiento_id) VALUES (?, ?)'
    );
    idsValidos.forEach((tratamientoId) => insertar.run(dentistaId, tratamientoId));
  })();

  res.json({ ok: true, tratamiento_ids: idsValidos });
});

// --- Catálogo de tratamientos (compartido por la clínica) ---

router.get('/tratamientos', (req, res) => {
  const tratamientos = db.prepare('SELECT * FROM tratamientos ORDER BY id').all();
  res.json({ ok: true, tratamientos });
});

router.post('/tratamientos', requireClinica, (req, res) => {
  const { nombre, precio, duracion_minutos: duracionMinutos } = req.body || {};
  const nombreLimpio = typeof nombre === 'string' ? nombre.trim() : '';
  const precioNum = Number(precio);
  const duracionNum = Number(duracionMinutos);
  if (!nombreLimpio || nombreLimpio.length > 80) {
    return res.status(400).json({ ok: false, error: 'Escribe el nombre del tratamiento.' });
  }
  if (!Number.isInteger(precioNum) || precioNum <= 0) {
    return res.status(400).json({ ok: false, error: 'El precio debe ser un número mayor a 0.' });
  }
  if (!Number.isInteger(duracionNum) || duracionNum <= 0) {
    return res.status(400).json({ ok: false, error: 'La duración debe ser un número de minutos mayor a 0.' });
  }

  const info = db
    .prepare('INSERT INTO tratamientos (nombre, precio, duracion_minutos, activo) VALUES (?, ?, ?, 1)')
    .run(nombreLimpio, precioNum, duracionNum);
  const tratamiento = db.prepare('SELECT * FROM tratamientos WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ ok: true, tratamiento });
});

router.patch('/tratamientos/:id', requireClinica, (req, res) => {
  const existente = db.prepare('SELECT * FROM tratamientos WHERE id = ?').get(req.params.id);
  if (!existente) {
    return res.status(404).json({ ok: false, error: 'Tratamiento no encontrado.' });
  }

  const { nombre, precio, duracion_minutos: duracionMinutos, activo } = req.body || {};
  const nombreLimpio = typeof nombre === 'string' && nombre.trim() ? nombre.trim().slice(0, 80) : existente.nombre;
  const precioNum = precio !== undefined ? Number(precio) : existente.precio;
  const duracionNum = duracionMinutos !== undefined ? Number(duracionMinutos) : existente.duracion_minutos;
  if (!Number.isInteger(precioNum) || precioNum <= 0) {
    return res.status(400).json({ ok: false, error: 'El precio debe ser un número mayor a 0.' });
  }
  if (!Number.isInteger(duracionNum) || duracionNum <= 0) {
    return res.status(400).json({ ok: false, error: 'La duración debe ser un número de minutos mayor a 0.' });
  }
  const activoFinal = typeof activo === 'boolean' ? (activo ? 1 : 0) : existente.activo;

  db.prepare('UPDATE tratamientos SET nombre = ?, precio = ?, duracion_minutos = ?, activo = ? WHERE id = ?').run(
    nombreLimpio,
    precioNum,
    duracionNum,
    activoFinal,
    req.params.id
  );
  const tratamiento = db.prepare('SELECT * FROM tratamientos WHERE id = ?').get(req.params.id);
  res.json({ ok: true, tratamiento });
});

router.delete('/tratamientos/:id', requireClinica, (req, res) => {
  const info = db.prepare('DELETE FROM tratamientos WHERE id = ?').run(req.params.id);
  if (info.changes === 0) {
    return res.status(404).json({ ok: false, error: 'Tratamiento no encontrado.' });
  }
  res.json({ ok: true });
});

// --- Horarios (plantilla semanal por dentista) ---

router.get('/horarios', (req, res) => {
  const dentistaId = Number(req.query.dentista_id ?? req.admin.dentista_id);
  if (!puedeAdministrarDentista(req.admin, dentistaId)) {
    return res.status(403).json({ ok: false, error: 'No autorizado.' });
  }
  const horarios = db.prepare('SELECT * FROM horarios WHERE dentista_id = ? ORDER BY id').all(dentistaId);
  res.json({ ok: true, horarios });
});

router.post('/horarios', (req, res) => {
  const { inicio, fin, dia_semana: diaSemana } = req.body || {};
  const dentistaId = Number(req.body?.dentista_id ?? req.admin.dentista_id);
  if (!puedeAdministrarDentista(req.admin, dentistaId)) {
    return res.status(403).json({ ok: false, error: 'No autorizado.' });
  }
  const dentista = db.prepare('SELECT id FROM dentistas WHERE id = ?').get(dentistaId);
  if (!dentista) {
    return res.status(404).json({ ok: false, error: 'Dentista no encontrado.' });
  }

  const inicioLimpio = typeof inicio === 'string' ? inicio.trim() : '';
  const finLimpio = typeof fin === 'string' ? fin.trim() : '';
  const dia = Number(diaSemana);
  if (!inicioLimpio || !finLimpio || inicioLimpio.length > 40 || finLimpio.length > 40) {
    return res.status(400).json({ ok: false, error: 'Inicio y fin son requeridos.' });
  }
  if (!Number.isInteger(dia) || dia < 0 || dia > 6) {
    return res.status(400).json({ ok: false, error: 'Día de la semana inválido.' });
  }
  const inicioMin = horaAMinutos(inicioLimpio);
  const finMin = horaAMinutos(finLimpio);
  if (inicioMin === null || finMin === null) {
    return res.status(400).json({ ok: false, error: 'Formato de hora inválido.' });
  }
  if (finMin <= inicioMin) {
    return res.status(400).json({ ok: false, error: 'La hora de fin debe ser después de la de inicio.' });
  }

  const info = db
    .prepare('INSERT INTO horarios (dentista_id, inicio, fin, activo, dia_semana) VALUES (?, ?, ?, 1, ?)')
    .run(dentistaId, inicioLimpio, finLimpio, dia);
  const horario = db.prepare('SELECT * FROM horarios WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ ok: true, horario });
});

router.patch('/horarios/:id', (req, res) => {
  const existente = db.prepare('SELECT * FROM horarios WHERE id = ?').get(req.params.id);
  if (!existente) {
    return res.status(404).json({ ok: false, error: 'Horario no encontrado.' });
  }
  if (!puedeAdministrarDentista(req.admin, existente.dentista_id)) {
    return res.status(403).json({ ok: false, error: 'No autorizado.' });
  }

  const { inicio, fin, activo } = req.body || {};
  const inicioLimpio = typeof inicio === 'string' && inicio.trim() ? inicio.trim().slice(0, 40) : existente.inicio;
  const finLimpio = typeof fin === 'string' && fin.trim() ? fin.trim().slice(0, 40) : existente.fin;
  const activoFinal = typeof activo === 'boolean' ? (activo ? 1 : 0) : existente.activo;

  const inicioMin = horaAMinutos(inicioLimpio);
  const finMin = horaAMinutos(finLimpio);
  if (inicioMin === null || finMin === null) {
    return res.status(400).json({ ok: false, error: 'Formato de hora inválido.' });
  }
  if (finMin <= inicioMin) {
    return res.status(400).json({ ok: false, error: 'La hora de fin debe ser después de la de inicio.' });
  }

  db.prepare('UPDATE horarios SET inicio = ?, fin = ?, activo = ? WHERE id = ?').run(
    inicioLimpio,
    finLimpio,
    activoFinal,
    req.params.id
  );
  const horario = db.prepare('SELECT * FROM horarios WHERE id = ?').get(req.params.id);
  res.json({ ok: true, horario });
});

router.delete('/horarios/:id', (req, res) => {
  const existente = db.prepare('SELECT * FROM horarios WHERE id = ?').get(req.params.id);
  if (!existente) {
    return res.status(404).json({ ok: false, error: 'Horario no encontrado.' });
  }
  if (!puedeAdministrarDentista(req.admin, existente.dentista_id)) {
    return res.status(403).json({ ok: false, error: 'No autorizado.' });
  }
  db.prepare('DELETE FROM horarios WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// --- Días bloqueados (vacaciones por dentista) ---

router.get('/dias-bloqueados', (req, res) => {
  const dentistaId = Number(req.query.dentista_id ?? req.admin.dentista_id);
  if (!puedeAdministrarDentista(req.admin, dentistaId)) {
    return res.status(403).json({ ok: false, error: 'No autorizado.' });
  }
  const dias = db
    .prepare('SELECT * FROM dias_bloqueados WHERE dentista_id = ? ORDER BY fecha_inicio')
    .all(dentistaId);
  res.json({ ok: true, dias });
});

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

router.post('/dias-bloqueados', (req, res) => {
  const dentistaId = Number(req.body?.dentista_id ?? req.admin.dentista_id);
  if (!puedeAdministrarDentista(req.admin, dentistaId)) {
    return res.status(403).json({ ok: false, error: 'No autorizado.' });
  }
  const dentista = db.prepare('SELECT id FROM dentistas WHERE id = ?').get(dentistaId);
  if (!dentista) {
    return res.status(404).json({ ok: false, error: 'Dentista no encontrado.' });
  }

  const { fecha_inicio: fechaInicio, fecha_fin: fechaFin, motivo } = req.body || {};
  if (!FECHA_RE.test(fechaInicio) || !FECHA_RE.test(fechaFin)) {
    return res.status(400).json({ ok: false, error: 'Elige una fecha de inicio y de fin.' });
  }
  if (fechaFin < fechaInicio) {
    return res.status(400).json({ ok: false, error: 'La fecha final debe ser igual o posterior a la inicial.' });
  }
  const motivoLimpio = typeof motivo === 'string' ? motivo.trim().slice(0, 120) : '';

  const info = db
    .prepare('INSERT INTO dias_bloqueados (dentista_id, fecha_inicio, fecha_fin, motivo) VALUES (?, ?, ?, ?)')
    .run(dentistaId, fechaInicio, fechaFin, motivoLimpio || null);
  const dia = db.prepare('SELECT * FROM dias_bloqueados WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ ok: true, dia });
});

router.delete('/dias-bloqueados/:id', (req, res) => {
  const existente = db.prepare('SELECT * FROM dias_bloqueados WHERE id = ?').get(req.params.id);
  if (!existente) {
    return res.status(404).json({ ok: false, error: 'No encontrado.' });
  }
  if (!puedeAdministrarDentista(req.admin, existente.dentista_id)) {
    return res.status(403).json({ ok: false, error: 'No autorizado.' });
  }
  db.prepare('DELETE FROM dias_bloqueados WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// --- Citas ---

router.get('/citas', (req, res) => {
  expirarPendientesVencidas(db);

  const { fecha, estado } = req.query;
  const condiciones = [];
  const params = [];

  if (req.admin.rol === 'clinica') {
    if (req.query.dentista_id) {
      condiciones.push('dentista_id = ?');
      params.push(Number(req.query.dentista_id));
    }
  } else {
    condiciones.push('dentista_id = ?');
    params.push(req.admin.dentista_id);
  }
  if (fecha) {
    condiciones.push('fecha = ?');
    params.push(fecha);
  }
  if (estado) {
    condiciones.push('estado = ?');
    params.push(estado);
  }
  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

  const citas = db.prepare(`SELECT * FROM citas ${where} ORDER BY fecha DESC, id DESC`).all(...params);
  res.json({ ok: true, citas });
});

router.patch('/citas/:id', (req, res) => {
  const { estado } = req.body || {};
  if (!['confirmada', 'cancelada'].includes(estado)) {
    return res.status(400).json({ ok: false, error: 'Estado inválido.' });
  }

  const resultado = db.transaction(() => {
    expirarPendientesVencidas(db);

    const cita = db.prepare('SELECT * FROM citas WHERE id = ?').get(req.params.id);
    if (!cita) {
      return { status: 404, body: { ok: false, error: 'Cita no encontrada.' } };
    }
    if (!puedeAdministrarDentista(req.admin, cita.dentista_id)) {
      return { status: 403, body: { ok: false, error: 'No autorizado.' } };
    }
    if (cita.estado !== 'pendiente') {
      return { status: 409, body: { ok: false, error: `Esta cita ya está "${cita.estado}".` } };
    }

    if (estado === 'confirmada') {
      db.prepare('UPDATE citas SET estado = ?, confirmada_en = ? WHERE id = ?').run(
        estado,
        Date.now(),
        req.params.id
      );
    } else {
      db.prepare('UPDATE citas SET estado = ? WHERE id = ?').run(estado, req.params.id);
    }

    const actualizada = db.prepare('SELECT * FROM citas WHERE id = ?').get(req.params.id);
    return { status: 200, body: { ok: true, cita: actualizada } };
  })();

  res.status(resultado.status).json(resultado.body);
});

module.exports = router;
