// Convierte "9:00 am", "9:00am", "09:00" o "21:00" a minutos desde
// medianoche. Devuelve null si el texto no tiene un formato de hora válido.
function horaAMinutos(texto) {
  const match = String(texto).trim().match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i);
  if (!match) return null;

  let h = Number(match[1]);
  const m = Number(match[2]);
  const periodo = match[3] ? match[3].toLowerCase() : null;

  if (periodo) {
    if (h === 12) h = 0;
    if (periodo === 'pm') h += 12;
  }
  if (h > 23 || m > 59) return null;

  return h * 60 + m;
}

module.exports = { horaAMinutos };
