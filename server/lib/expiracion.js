// Tiempo máximo que una reserva puede quedar "pendiente" sin confirmación
// antes de expirar automáticamente y liberar su bloque.
const EXPIRACION_MS = 2 * 60 * 60 * 1000; // 2 horas

function expirarPendientesVencidas(db) {
  const limite = Date.now() - EXPIRACION_MS;
  db.prepare(
    `UPDATE reservas SET estado = 'expirada' WHERE estado = 'pendiente' AND creada_en <= ?`
  ).run(limite);
}

module.exports = { EXPIRACION_MS, expirarPendientesVencidas };
