const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { crearSesion, destruirSesion, requireAdminApi } = require('../middleware/auth');
const { expirarPendientesVencidas } = require('../lib/expiracion');

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

router.get('/horarios', (req, res) => {
  const horarios = db.prepare('SELECT * FROM horarios ORDER BY id').all();
  res.json({ ok: true, horarios });
});

router.post('/horarios', (req, res) => {
  const { inicio, fin, dia_semana: diaSemana } = req.body || {};
  const inicioLimpio = typeof inicio === 'string' ? inicio.trim() : '';
  const finLimpio = typeof fin === 'string' ? fin.trim() : '';
  const dia = Number(diaSemana);
  if (!inicioLimpio || !finLimpio || inicioLimpio.length > 40 || finLimpio.length > 40) {
    return res.status(400).json({ ok: false, error: 'Inicio y fin son requeridos.' });
  }
  if (!Number.isInteger(dia) || dia < 0 || dia > 6) {
    return res.status(400).json({ ok: false, error: 'Día de la semana inválido.' });
  }

  const info = db
    .prepare('INSERT INTO horarios (inicio, fin, activo, dia_semana) VALUES (?, ?, 1, ?)')
    .run(inicioLimpio, finLimpio, dia);
  const horario = db.prepare('SELECT * FROM horarios WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ ok: true, horario });
});

router.patch('/horarios/:id', (req, res) => {
  const existente = db.prepare('SELECT * FROM horarios WHERE id = ?').get(req.params.id);
  if (!existente) {
    return res.status(404).json({ ok: false, error: 'Horario no encontrado.' });
  }

  const { inicio, fin, activo } = req.body || {};
  const inicioLimpio = typeof inicio === 'string' && inicio.trim() ? inicio.trim().slice(0, 40) : existente.inicio;
  const finLimpio = typeof fin === 'string' && fin.trim() ? fin.trim().slice(0, 40) : existente.fin;
  const activoFinal = typeof activo === 'boolean' ? (activo ? 1 : 0) : existente.activo;

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
  const info = db.prepare('DELETE FROM horarios WHERE id = ?').run(req.params.id);
  if (info.changes === 0) {
    return res.status(404).json({ ok: false, error: 'Horario no encontrado.' });
  }
  res.json({ ok: true });
});

router.get('/servicios', (req, res) => {
  const servicios = db.prepare('SELECT * FROM servicios ORDER BY id').all();
  res.json({ ok: true, servicios });
});

router.post('/servicios', (req, res) => {
  const { nombre, precio, duracion_minutos: duracionMinutos } = req.body || {};
  const nombreLimpio = typeof nombre === 'string' ? nombre.trim() : '';
  const precioNum = Number(precio);
  const duracionNum = Number(duracionMinutos);
  if (!nombreLimpio || nombreLimpio.length > 80) {
    return res.status(400).json({ ok: false, error: 'Escribe el nombre del servicio.' });
  }
  if (!Number.isInteger(precioNum) || precioNum <= 0) {
    return res.status(400).json({ ok: false, error: 'El precio debe ser un número mayor a 0.' });
  }
  if (!Number.isInteger(duracionNum) || duracionNum <= 0) {
    return res.status(400).json({ ok: false, error: 'La duración debe ser un número de minutos mayor a 0.' });
  }

  const info = db
    .prepare('INSERT INTO servicios (nombre, precio, duracion_minutos, activo) VALUES (?, ?, ?, 1)')
    .run(nombreLimpio, precioNum, duracionNum);
  const servicio = db.prepare('SELECT * FROM servicios WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ ok: true, servicio });
});

router.patch('/servicios/:id', (req, res) => {
  const existente = db.prepare('SELECT * FROM servicios WHERE id = ?').get(req.params.id);
  if (!existente) {
    return res.status(404).json({ ok: false, error: 'Servicio no encontrado.' });
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

  db.prepare('UPDATE servicios SET nombre = ?, precio = ?, duracion_minutos = ?, activo = ? WHERE id = ?').run(
    nombreLimpio,
    precioNum,
    duracionNum,
    activoFinal,
    req.params.id
  );
  const servicio = db.prepare('SELECT * FROM servicios WHERE id = ?').get(req.params.id);
  res.json({ ok: true, servicio });
});

router.delete('/servicios/:id', (req, res) => {
  const info = db.prepare('DELETE FROM servicios WHERE id = ?').run(req.params.id);
  if (info.changes === 0) {
    return res.status(404).json({ ok: false, error: 'Servicio no encontrado.' });
  }
  res.json({ ok: true });
});

router.get('/reservas', (req, res) => {
  expirarPendientesVencidas(db);

  const { fecha, estado } = req.query;
  const condiciones = [];
  const params = [];
  if (fecha) {
    condiciones.push('fecha = ?');
    params.push(fecha);
  }
  if (estado) {
    condiciones.push('estado = ?');
    params.push(estado);
  }
  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

  const reservas = db
    .prepare(`SELECT * FROM reservas ${where} ORDER BY fecha DESC, id DESC`)
    .all(...params);
  res.json({ ok: true, reservas });
});

router.patch('/reservas/:id', (req, res) => {
  const { estado } = req.body || {};
  if (!['confirmada', 'cancelada'].includes(estado)) {
    return res.status(400).json({ ok: false, error: 'Estado inválido.' });
  }

  const resultado = db.transaction(() => {
    expirarPendientesVencidas(db);

    const reserva = db.prepare('SELECT * FROM reservas WHERE id = ?').get(req.params.id);
    if (!reserva) {
      return { status: 404, body: { ok: false, error: 'Reserva no encontrada.' } };
    }
    if (reserva.estado !== 'pendiente') {
      return { status: 409, body: { ok: false, error: `Esta reserva ya está "${reserva.estado}".` } };
    }

    if (estado === 'confirmada') {
      db.prepare('UPDATE reservas SET estado = ?, confirmada_en = ? WHERE id = ?').run(
        estado,
        Date.now(),
        req.params.id
      );
    } else {
      db.prepare('UPDATE reservas SET estado = ? WHERE id = ?').run(estado, req.params.id);
    }

    const actualizada = db.prepare('SELECT * FROM reservas WHERE id = ?').get(req.params.id);
    return { status: 200, body: { ok: true, reserva: actualizada } };
  })();

  res.status(resultado.status).json(resultado.body);
});

module.exports = router;
