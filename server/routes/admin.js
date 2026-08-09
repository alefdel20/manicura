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
  const { inicio, fin } = req.body || {};
  const inicioLimpio = typeof inicio === 'string' ? inicio.trim() : '';
  const finLimpio = typeof fin === 'string' ? fin.trim() : '';
  if (!inicioLimpio || !finLimpio || inicioLimpio.length > 40 || finLimpio.length > 40) {
    return res.status(400).json({ ok: false, error: 'Inicio y fin son requeridos.' });
  }

  const info = db
    .prepare('INSERT INTO horarios (inicio, fin, activo) VALUES (?, ?, 1)')
    .run(inicioLimpio, finLimpio);
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
