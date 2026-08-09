const crypto = require('crypto');
const db = require('../db');

const COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'sid';
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || undefined;
// 'lax' basta si frontend/backend comparten dominio raíz (p.ej. ambos bajo
// *.ankode.cloud). Si terminan en dominios totalmente distintos, hay que
// pasar COOKIE_SAMESITE=none (obliga secure:true + HTTPS en ambos).
const COOKIE_SAMESITE = process.env.COOKIE_SAMESITE || 'lax';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 días

function baseCookieAttrs() {
  const attrs = { path: '/' };
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

function requireAdminApi(req, res, next) {
  const sesion = obtenerSesion(req);
  if (!sesion) {
    return res.status(401).json({ ok: false, error: 'No autorizado.' });
  }
  req.admin = sesion.usuario;
  next();
}

module.exports = { crearSesion, destruirSesion, obtenerSesion, requireAdminApi, COOKIE_NAME };
