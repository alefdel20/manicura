const crypto = require('crypto');
const db = require('../db');

// Nombre distinto del cookie de sesión de manicura (comparten el mismo
// backend/dominio) — si ambos usaran "sid" a secas, iniciar sesión en un
// panel cerraría la sesión del otro sin avisar.
const COOKIE_NAME = process.env.DENTISTA_SESSION_COOKIE_NAME || 'sid_dentista';
// COOKIE_DOMAIN/COOKIE_SAMESITE sí se comparten con manicura (mismo dominio
// raíz), así que reutilizan las mismas variables de entorno.
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || undefined;
// 'lax' basta si frontend/backend comparten dominio raíz (p.ej. ambos bajo
// *.ankode.cloud). Si terminan en dominios totalmente distintos, hay que
// pasar COOKIE_SAMESITE=none (obliga secure:true + HTTPS en ambos).
const COOKIE_SAMESITE = process.env.COOKIE_SAMESITE || 'lax';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 días

function baseCookieAttrs() {
  // Path acotado a /api/dentista: el navegador solo manda esta cookie en
  // llamadas al panel de dentista, nunca al resto de la API de manicura.
  const attrs = { path: '/api/dentista' };
  if (COOKIE_DOMAIN) attrs.domain = COOKIE_DOMAIN;
  return attrs;
}

function cookieOptions() {
  return {
    ...baseCookieAttrs(),
    httpOnly: true,
    sameSite: COOKIE_SAMESITE,
    secure: COOKIE_SAMESITE === 'none' || process.env.NODE_ENV === 'production',
    maxAge: SESSION_TTL_MS,
  };
}

function crearSesion(res, usuario) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiraEn = Date.now() + SESSION_TTL_MS;
  db.prepare('INSERT INTO sesiones (id, usuario, expira_en) VALUES (?, ?, ?)').run(token, usuario, expiraEn);
  res.cookie(COOKIE_NAME, token, cookieOptions());
}

function destruirSesion(req, res) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (token) {
    db.prepare('DELETE FROM sesiones WHERE id = ?').run(token);
  }
  res.clearCookie(COOKIE_NAME, baseCookieAttrs());
}

function obtenerSesion(req) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (!token) return null;
  const sesion = db.prepare('SELECT * FROM sesiones WHERE id = ?').get(token);
  if (!sesion) return null;
  if (sesion.expira_en <= Date.now()) {
    db.prepare('DELETE FROM sesiones WHERE id = ?').run(token);
    return null;
  }
  return sesion;
}

// Adjunta req.admin = { usuario, rol, dentista_id } a partir de la cookie de
// sesión. rol='clinica' administra todo; rol='dentista' solo su propia
// agenda (dentista_id).
function requireAdminApi(req, res, next) {
  const sesion = obtenerSesion(req);
  if (!sesion) {
    return res.status(401).json({ ok: false, error: 'No autorizado.' });
  }
  const cuenta = db.prepare('SELECT usuario, rol, dentista_id FROM admin WHERE usuario = ?').get(sesion.usuario);
  if (!cuenta) {
    return res.status(401).json({ ok: false, error: 'No autorizado.' });
  }
  req.admin = cuenta;
  next();
}

// Algunas rutas (gestión de dentistas, catálogo de tratamientos) son
// exclusivas de la cuenta de clínica — un dentista no puede dar de alta a
// otro dentista ni tocar precios del catálogo compartido.
function requireClinica(req, res, next) {
  if (!req.admin || req.admin.rol !== 'clinica') {
    return res.status(403).json({ ok: false, error: 'Solo la cuenta de la clínica puede hacer esto.' });
  }
  next();
}

// Para rutas ligadas a un dentista concreto (horarios, días bloqueados,
// tratamientos que ofrece): la clínica puede operar sobre cualquiera;
// un dentista solo sobre sí mismo.
function puedeAdministrarDentista(admin, dentistaId) {
  if (admin.rol === 'clinica') return true;
  return admin.dentista_id === Number(dentistaId);
}

module.exports = {
  crearSesion,
  destruirSesion,
  obtenerSesion,
  requireAdminApi,
  requireClinica,
  puedeAdministrarDentista,
  COOKIE_NAME,
};
