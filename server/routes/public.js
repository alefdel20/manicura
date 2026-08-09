const express = require('express');
const db = require('../db');
const { expirarPendientesVencidas } = require('../lib/expiracion');

const router = express.Router();

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

function fechaValida(fecha) {
  if (!FECHA_RE.test(fecha)) return false;
  const [y, m, d] = fecha.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

router.get('/disponibilidad', (req, res) => {
  const { fecha } = req.query;
  if (!fecha || !fechaValida(fecha)) {
    return res.status(400).json({ ok: false, error: 'Fecha inválida.' });
  }

  expirarPendientesVencidas(db);

  const horarios = db.prepare('SELECT inicio, fin FROM horarios WHERE activo = 1 ORDER BY id').all();
  const ocupados = new Set(
    db
      .prepare(`SELECT bloque FROM reservas WHERE fecha = ? AND estado IN ('pendiente','confirmada')`)
      .all(fecha)
      .map((r) => r.bloque)
  );

  const bloques = horarios
    .map((h) => `${h.inicio} - ${h.fin}`)
    .filter((b) => !ocupados.has(b));

  res.json({ ok: true, bloques });
});

router.post('/reservar', (req, res) => {
  const { fecha, bloque, nombre, comentario } = req.body || {};

  if (!fecha || !fechaValida(fecha)) {
    return res.status(400).json({ ok: false, error: 'Fecha inválida.' });
  }
  if (!bloque || typeof bloque !== 'string' || bloque.length > 100) {
    return res.status(400).json({ ok: false, error: 'Horario inválido.' });
  }
  const nombreLimpio = typeof nombre === 'string' ? nombre.trim() : '';
  if (!nombreLimpio || nombreLimpio.length > 100) {
    return res.status(400).json({ ok: false, error: 'Escribe tu nombre.' });
  }
  const comentarioLimpio = typeof comentario === 'string' ? comentario.trim().slice(0, 500) : '';

  const resultado = db.transaction(() => {
    expirarPendientesVencidas(db);

    const bloqueActivo = db
      .prepare('SELECT 1 FROM horarios WHERE activo = 1 AND (inicio || \' - \' || fin) = ?')
      .get(bloque);
    if (!bloqueActivo) {
      return { ok: false, error: 'Ese horario ya no está disponible — elige otro.' };
    }

    const ocupado = db
      .prepare(
        `SELECT 1 FROM reservas WHERE fecha = ? AND bloque = ? AND estado IN ('pendiente','confirmada')`
      )
      .get(fecha, bloque);
    if (ocupado) {
      return { ok: false, error: 'Ese horario ya se acaba de ocupar — elige otro.' };
    }

    db.prepare(
      `INSERT INTO reservas (fecha, bloque, nombre_cliente, comentario, estado, creada_en)
       VALUES (?, ?, ?, ?, 'pendiente', ?)`
    ).run(fecha, bloque, nombreLimpio, comentarioLimpio, Date.now());

    return { ok: true };
  })();

  res.status(resultado.ok ? 200 : 409).json(resultado);
});

module.exports = router;
