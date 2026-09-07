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

function diaSemanaDe(fecha) {
  const [y, m, d] = fecha.split('-').map(Number);
  return new Date(y, m - 1, d).getDay(); // 0=domingo ... 6=sábado
}

// Vacaciones / días fuera de la plantilla semanal de un dentista — anulan su
// disponibilidad esa fecha sin importar qué diga `horarios` ese día.
function fechaBloqueadaParaDentista(dentistaId, fecha) {
  return !!db
    .prepare(
      'SELECT 1 FROM dias_bloqueados WHERE dentista_id = ? AND ? BETWEEN fecha_inicio AND fecha_fin'
    )
    .get(dentistaId, fecha);
}

router.get('/tratamientos', (req, res) => {
  const tratamientos = db
    .prepare('SELECT id, nombre, precio, duracion_minutos FROM tratamientos WHERE activo = 1 ORDER BY id')
    .all();
  res.json({ ok: true, tratamientos });
});

// Sin `tratamiento_id`: todo el equipo activo (para mostrarlo en la página).
// Con `tratamiento_id`: solo quienes lo ofrecen — el paciente elige primero
// el tratamiento y aquí se le muestra con quién puede agendarlo.
router.get('/dentistas', (req, res) => {
  const { tratamiento_id: tratamientoId } = req.query;

  if (tratamientoId === undefined) {
    const dentistas = db
      .prepare('SELECT id, nombre, especialidad, bio FROM dentistas WHERE activo = 1 ORDER BY nombre')
      .all();
    return res.json({ ok: true, dentistas });
  }

  const idNum = Number(tratamientoId);
  if (!Number.isInteger(idNum) || idNum <= 0) {
    return res.status(400).json({ ok: false, error: 'Elige un tratamiento válido.' });
  }

  const dentistas = db
    .prepare(
      `SELECT d.id, d.nombre, d.especialidad, d.bio
       FROM dentistas d
       JOIN dentista_tratamientos dt ON dt.dentista_id = d.id
       WHERE d.activo = 1 AND dt.tratamiento_id = ?
       ORDER BY d.nombre`
    )
    .all(idNum);
  res.json({ ok: true, dentistas });
});

router.get('/disponibilidad', (req, res) => {
  const { fecha, dentista_id: dentistaId } = req.query;
  const dentistaIdNum = Number(dentistaId);
  if (!Number.isInteger(dentistaIdNum) || dentistaIdNum <= 0) {
    return res.status(400).json({ ok: false, error: 'Elige un dentista válido.' });
  }
  if (!fecha || !fechaValida(fecha)) {
    return res.status(400).json({ ok: false, error: 'Fecha inválida.' });
  }

  expirarPendientesVencidas(db);

  if (fechaBloqueadaParaDentista(dentistaIdNum, fecha)) {
    return res.json({ ok: true, bloques: [] });
  }

  const horarios = db
    .prepare('SELECT inicio, fin FROM horarios WHERE dentista_id = ? AND activo = 1 AND dia_semana = ? ORDER BY id')
    .all(dentistaIdNum, diaSemanaDe(fecha));
  const ocupados = new Set(
    db
      .prepare(
        `SELECT bloque FROM citas WHERE dentista_id = ? AND fecha = ? AND estado IN ('pendiente','confirmada')`
      )
      .all(dentistaIdNum, fecha)
      .map((c) => c.bloque)
  );

  const bloques = horarios
    .map((h) => `${h.inicio} - ${h.fin}`)
    .filter((b) => !ocupados.has(b));

  res.json({ ok: true, bloques });
});

router.post('/reservar', (req, res) => {
  const {
    fecha,
    bloque,
    nombre,
    telefono,
    dentista_id: dentistaId,
    tratamiento_id: tratamientoId,
    comentario,
  } = req.body || {};

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
  const telefonoLimpio = typeof telefono === 'string' ? telefono.replace(/\D/g, '') : '';
  if (telefonoLimpio.length !== 10) {
    return res.status(400).json({ ok: false, error: 'Escribe un teléfono a 10 dígitos.' });
  }
  const comentarioLimpio = typeof comentario === 'string' ? comentario.trim().slice(0, 500) : '';

  const resultado = db.transaction(() => {
    expirarPendientesVencidas(db);

    const dentista = db
      .prepare('SELECT id, nombre FROM dentistas WHERE id = ? AND activo = 1')
      .get(dentistaId);
    if (!dentista) {
      return { ok: false, error: 'Elige un dentista válido.' };
    }

    const tratamiento = db
      .prepare('SELECT id, nombre, precio FROM tratamientos WHERE id = ? AND activo = 1')
      .get(tratamientoId);
    if (!tratamiento) {
      return { ok: false, error: 'Elige un tratamiento válido.' };
    }

    const loOfrece = db
      .prepare('SELECT 1 FROM dentista_tratamientos WHERE dentista_id = ? AND tratamiento_id = ?')
      .get(dentista.id, tratamiento.id);
    if (!loOfrece) {
      return { ok: false, error: 'Ese dentista no ofrece el tratamiento elegido.' };
    }

    if (fechaBloqueadaParaDentista(dentista.id, fecha)) {
      return { ok: false, error: 'Esa fecha no está disponible con este dentista.' };
    }

    const bloqueActivo = db
      .prepare(
        `SELECT 1 FROM horarios
         WHERE dentista_id = ? AND activo = 1 AND dia_semana = ? AND (inicio || ' - ' || fin) = ?`
      )
      .get(dentista.id, diaSemanaDe(fecha), bloque);
    if (!bloqueActivo) {
      return { ok: false, error: 'Ese horario ya no está disponible — elige otro.' };
    }

    const ocupado = db
      .prepare(
        `SELECT 1 FROM citas
         WHERE dentista_id = ? AND fecha = ? AND bloque = ? AND estado IN ('pendiente','confirmada')`
      )
      .get(dentista.id, fecha, bloque);
    if (ocupado) {
      return { ok: false, error: 'Ese horario ya se acaba de ocupar — elige otro.' };
    }

    db.prepare(
      `INSERT INTO citas
        (dentista_id, dentista_nombre, fecha, bloque, nombre_paciente, telefono,
         tratamiento_id, tratamiento_nombre, tratamiento_precio, comentario, estado, creada_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendiente', ?)`
    ).run(
      dentista.id,
      dentista.nombre,
      fecha,
      bloque,
      nombreLimpio,
      telefonoLimpio,
      tratamiento.id,
      tratamiento.nombre,
      tratamiento.precio,
      comentarioLimpio,
      Date.now()
    );

    return { ok: true };
  })();

  res.status(resultado.ok ? 200 : 409).json(resultado);
});

module.exports = router;
