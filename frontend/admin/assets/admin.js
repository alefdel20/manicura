// ⚠️ URL del servicio backend (API), sin slash final.
const API_BASE_URL = 'https://backen-general.ankode.cloud';

async function apiFetch(path, options){
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    ...options,
  });
  if(res.status === 401){
    window.location.href = '/admin/login.html';
    throw new Error('No autorizado');
  }
  return res.json();
}

function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function fechaLegible(fechaVal){
  const [y,m,d] = fechaVal.split('-').map(Number);
  return new Date(y, m-1, d).toLocaleDateString('es-MX', {weekday:'long', day:'numeric', month:'long'});
}

// --- Tabs ---
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    if(btn.dataset.tab === 'reservas') cargarReservas();
    if(btn.dataset.tab === 'servicios') cargarServicios();
  });
});

// --- Logout ---
document.getElementById('logout-btn').addEventListener('click', async () => {
  await apiFetch('/api/admin/logout', { method: 'POST' });
  window.location.href = '/admin/login.html';
});

// --- Horarios (vista semanal) ---
// Mismo día de la semana que Date.getDay() (0=domingo..6=sábado), mostrado
// en orden de semana laboral.
const DIAS = [
  { key: 1, label: 'Lunes' },
  { key: 2, label: 'Martes' },
  { key: 3, label: 'Miércoles' },
  { key: 4, label: 'Jueves' },
  { key: 5, label: 'Viernes' },
  { key: 6, label: 'Sábado' },
  { key: 0, label: 'Domingo' },
];

const horariosSemana = document.getElementById('horarios-semana');

// Selector de hora propio (sugerencias cada 30 min, 6:00 am a 10:00 pm) —
// un datalist nativo no se puede re-estilizar ni personalizar su interacción,
// por eso este combobox se arma a mano con el mismo look del sitio.
let formato24h = false;
const formatoToggle = document.getElementById('formato-24h-toggle');
const timeDropdown = document.getElementById('time-picker-dropdown');
let timeDropdownInput = null;

// Bloques ya guardados por día (minutos desde medianoche), para no sugerir
// horas que ya caen dentro de un bloque existente ese día.
let horariosPorDia = {};

function horaAMinutos(texto){
  const match = String(texto).trim().match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i);
  if(!match) return null;
  let h = Number(match[1]);
  const m = Number(match[2]);
  const periodo = match[3] ? match[3].toLowerCase() : null;
  if(periodo){
    if(h === 12) h = 0;
    if(periodo === 'pm') h += 12;
  }
  if(h > 23 || m > 59) return null;
  return h * 60 + m;
}

function actualizarHorariosPorDia(horarios){
  horariosPorDia = {};
  horarios.forEach((h) => {
    const inicioMin = horaAMinutos(h.inicio);
    const finMin = horaAMinutos(h.fin);
    if(inicioMin === null || finMin === null) return;
    if(!horariosPorDia[h.dia_semana]) horariosPorDia[h.dia_semana] = [];
    horariosPorDia[h.dia_semana].push({ inicioMin, finMin });
  });
}

function obtenerDiaDeInput(input){
  const form = input.closest('.horario-form');
  return form ? Number(form.dataset.dia) : null;
}

function generarOpcionesHora(diaKey){
  const ocupados = horariosPorDia[diaKey] || [];
  const opciones = [];
  for(let mins = 6 * 60; mins <= 22 * 60; mins += 30){
    const enConflicto = ocupados.some((r) => mins >= r.inicioMin && mins <= r.finMin);
    if(enConflicto) continue;
    const h24 = Math.floor(mins / 60);
    const m = mins % 60;
    if(formato24h){
      opciones.push(`${String(h24).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    } else {
      const periodo = h24 < 12 ? 'am' : 'pm';
      const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
      opciones.push(`${h12}:${String(m).padStart(2, '0')} ${periodo}`);
    }
  }
  return opciones;
}

function cerrarTimeDropdown(){
  timeDropdown.classList.remove('open');
  timeDropdownInput = null;
}

function filtrarYRenderOpciones(input){
  const dia = obtenerDiaDeInput(input);
  const filtro = input.value.trim().toLowerCase();
  const opciones = generarOpcionesHora(dia).filter((o) => o.toLowerCase().includes(filtro));
  timeDropdown.innerHTML = opciones.length
    ? opciones.map((o) => `<div class="option" data-value="${o}">${escapeHtml(o)}</div>`).join('')
    : '<div class="empty">Sin horarios libres que coincidan — puedes escribir tu propia hora.</div>';
}

function abrirTimeDropdown(input){
  timeDropdownInput = input;
  const rect = input.getBoundingClientRect();
  timeDropdown.style.left = `${rect.left}px`;
  timeDropdown.style.top = `${rect.bottom + 4}px`;
  timeDropdown.style.width = `${rect.width}px`;
  filtrarYRenderOpciones(input);
  timeDropdown.classList.add('open');
}

if(formatoToggle){
  formatoToggle.addEventListener('change', () => {
    formato24h = formatoToggle.checked;
    if(timeDropdownInput) filtrarYRenderOpciones(timeDropdownInput);
  });
}

// Si la página hace scroll con el menú abierto, se cierra en vez de quedar
// desalineado (su posición se calcula solo al abrirse).
window.addEventListener('scroll', () => {
  if(timeDropdownInput) cerrarTimeDropdown();
}, true);

timeDropdown.addEventListener('mousedown', (e) => {
  const opt = e.target.closest('.option');
  if(!opt || !timeDropdownInput) return;
  e.preventDefault(); // evita que el input pierda foco antes del click
  timeDropdownInput.value = opt.dataset.value;
  cerrarTimeDropdown();
});

document.addEventListener('click', (e) => {
  if(timeDropdownInput && !timeDropdown.contains(e.target) && e.target !== timeDropdownInput){
    cerrarTimeDropdown();
  }
});

function crearDiaCard(dia){
  const card = document.createElement('div');
  card.className = 'panel-card';
  card.innerHTML = `
    <h2>${dia.label}</h2>
    <form class="form-row horario-form" data-dia="${dia.key}" novalidate>
      <div class="field-inline">
        <label>Inicio</label>
        <input type="text" class="h-inicio" placeholder="9:00 am" autocomplete="off" required>
      </div>
      <div class="field-inline">
        <label>Fin</label>
        <input type="text" class="h-fin" placeholder="11:00 am" autocomplete="off" required>
      </div>
      <button type="submit" class="btn btn-primary btn-sm">+ Agregar bloque</button>
    </form>
    <p class="msg error horario-error"></p>
    <table>
      <thead><tr><th>Inicio</th><th>Fin</th><th>Estado</th><th></th></tr></thead>
      <tbody class="horario-body"></tbody>
    </table>
    <p class="empty horario-empty" style="display:none;">Sin bloques — no aparece disponible este día.</p>
  `;
  return card;
}

DIAS.forEach((dia) => horariosSemana.appendChild(crearDiaCard(dia)));

horariosSemana.addEventListener('focusin', (e) => {
  if(e.target.matches('.h-inicio, .h-fin')) abrirTimeDropdown(e.target);
});

horariosSemana.addEventListener('input', (e) => {
  if(e.target.matches('.h-inicio, .h-fin') && timeDropdownInput === e.target){
    filtrarYRenderOpciones(e.target);
  }
});

function renderHorarios(horarios){
  actualizarHorariosPorDia(horarios);

  DIAS.forEach((dia) => {
    const form = horariosSemana.querySelector(`form.horario-form[data-dia="${dia.key}"]`);
    const card = form.closest('.panel-card');
    const tbody = card.querySelector('.horario-body');
    const empty = card.querySelector('.horario-empty');
    const delDia = horarios.filter((h) => h.dia_semana === dia.key);

    tbody.innerHTML = '';
    empty.style.display = delDia.length ? 'none' : 'block';

    delDia.forEach((h) => {
      const tr = document.createElement('tr');
      if(!h.activo) tr.classList.add('inactivo');
      tr.innerHTML = `
        <td>${escapeHtml(h.inicio)}</td>
        <td>${escapeHtml(h.fin)}</td>
        <td><span class="chip ${h.activo ? 'chip-confirmada' : 'chip-cancelada'}">${h.activo ? 'Activo' : 'Inactivo'}</span></td>
        <td class="actions-cell">
          <button class="btn btn-ghost btn-sm" data-action="toggle" data-id="${h.id}" data-activo="${h.activo}">${h.activo ? 'Desactivar' : 'Activar'}</button>
          <button class="btn btn-danger btn-sm" data-action="eliminar" data-id="${h.id}">Eliminar</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  });
}

async function cargarHorarios(){
  const data = await apiFetch('/api/admin/horarios');
  if(data.ok) renderHorarios(data.horarios);
}

horariosSemana.addEventListener('submit', async (e) => {
  const form = e.target.closest('form.horario-form');
  if(!form) return;
  e.preventDefault();

  const errorEl = form.closest('.panel-card').querySelector('.horario-error');
  errorEl.classList.remove('show');
  const dia = Number(form.dataset.dia);
  const inicio = form.querySelector('.h-inicio').value.trim();
  const fin = form.querySelector('.h-fin').value.trim();
  if(!inicio || !fin){
    errorEl.textContent = 'Completa inicio y fin.';
    errorEl.classList.add('show');
    return;
  }

  const data = await apiFetch('/api/admin/horarios', {
    method: 'POST',
    body: JSON.stringify({ inicio, fin, dia_semana: dia }),
  });
  if(!data.ok){
    errorEl.textContent = data.error || 'No se pudo agregar el bloque.';
    errorEl.classList.add('show');
    return;
  }
  form.reset();
  cargarHorarios();
});

horariosSemana.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action]');
  if(!btn) return;
  const id = btn.dataset.id;

  if(btn.dataset.action === 'toggle'){
    const activo = btn.dataset.activo === '1' || btn.dataset.activo === 'true';
    await apiFetch(`/api/admin/horarios/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ activo: !activo }),
    });
    cargarHorarios();
  }

  if(btn.dataset.action === 'eliminar'){
    if(!confirm('¿Eliminar este bloque? Ya no se ofrecerá a clientas.')) return;
    await apiFetch(`/api/admin/horarios/${id}`, { method: 'DELETE' });
    cargarHorarios();
  }
});

// --- Servicios ---
const serviciosBody = document.getElementById('servicios-body');
const serviciosEmpty = document.getElementById('servicios-empty');
const servicioForm = document.getElementById('servicio-form');
const servicioError = document.getElementById('servicio-error');

function renderServicios(servicios){
  serviciosBody.innerHTML = '';
  serviciosEmpty.style.display = servicios.length ? 'none' : 'block';

  servicios.forEach((s) => {
    const tr = document.createElement('tr');
    if(!s.activo) tr.classList.add('inactivo');
    tr.innerHTML = `
      <td>${escapeHtml(s.nombre)}</td>
      <td>$${s.precio} MXN</td>
      <td>${s.duracion_minutos} min</td>
      <td><span class="chip ${s.activo ? 'chip-confirmada' : 'chip-cancelada'}">${s.activo ? 'Activo' : 'Inactivo'}</span></td>
      <td class="actions-cell">
        <button class="btn btn-ghost btn-sm" data-action="toggle" data-id="${s.id}" data-activo="${s.activo}">${s.activo ? 'Desactivar' : 'Activar'}</button>
        <button class="btn btn-danger btn-sm" data-action="eliminar" data-id="${s.id}">Eliminar</button>
      </td>
    `;
    serviciosBody.appendChild(tr);
  });
}

async function cargarServicios(){
  const data = await apiFetch('/api/admin/servicios');
  if(data.ok) renderServicios(data.servicios);
}

servicioForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  servicioError.classList.remove('show');
  const nombre = document.getElementById('s-nombre').value.trim();
  const precio = document.getElementById('s-precio').value;
  const duracion = document.getElementById('s-duracion').value;
  if(!nombre || !precio || !duracion){
    servicioError.textContent = 'Completa nombre, precio y duración.';
    servicioError.classList.add('show');
    return;
  }

  const data = await apiFetch('/api/admin/servicios', {
    method: 'POST',
    body: JSON.stringify({ nombre, precio: Number(precio), duracion_minutos: Number(duracion) }),
  });
  if(!data.ok){
    servicioError.textContent = data.error || 'No se pudo agregar el servicio.';
    servicioError.classList.add('show');
    return;
  }
  servicioForm.reset();
  cargarServicios();
});

serviciosBody.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action]');
  if(!btn) return;
  const id = btn.dataset.id;

  if(btn.dataset.action === 'toggle'){
    const activo = btn.dataset.activo === '1' || btn.dataset.activo === 'true';
    await apiFetch(`/api/admin/servicios/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ activo: !activo }),
    });
    cargarServicios();
  }

  if(btn.dataset.action === 'eliminar'){
    if(!confirm('¿Eliminar este servicio?')) return;
    await apiFetch(`/api/admin/servicios/${id}`, { method: 'DELETE' });
    cargarServicios();
  }
});

// --- Reservas ---
const reservasBody = document.getElementById('reservas-body');
const reservasEmpty = document.getElementById('reservas-empty');
const filtroFecha = document.getElementById('f-fecha');
const filtroEstado = document.getElementById('f-estado');

const ESTADO_LABEL = {
  pendiente: 'Pendiente',
  confirmada: 'Confirmada',
  expirada: 'Expirada',
  cancelada: 'Cancelada',
};

function renderReservas(reservas){
  reservasBody.innerHTML = '';
  reservasEmpty.style.display = reservas.length ? 'none' : 'block';

  reservas.forEach((r) => {
    const tr = document.createElement('tr');
    tr.classList.add(`estado-${r.estado}`);

    let acciones = '';
    if(r.estado === 'pendiente'){
      acciones += `<button class="btn btn-primary btn-sm" data-action="confirmar" data-id="${r.id}">Confirmar ✓</button>`;
      if(r.telefono){
        acciones += `<button class="btn btn-ghost btn-sm" data-action="recordatorio" data-fecha="${escapeHtml(r.fecha)}" data-bloque="${escapeHtml(r.bloque)}" data-telefono="${escapeHtml(r.telefono)}">Enviar recordatorio</button>`;
      }
      acciones += `<button class="btn btn-danger btn-sm" data-action="cancelar" data-id="${r.id}">Cancelar</button>`;
    }

    const servicioTexto = r.servicio_nombre ? `${r.servicio_nombre} ($${r.servicio_precio} MXN)` : '—';

    tr.innerHTML = `
      <td>${escapeHtml(r.fecha)}</td>
      <td>${escapeHtml(r.bloque)}</td>
      <td>${escapeHtml(r.nombre_cliente)}</td>
      <td>${escapeHtml(r.telefono || '—')}</td>
      <td>${escapeHtml(servicioTexto)}</td>
      <td>${escapeHtml(r.comentario || '—')}</td>
      <td><span class="chip chip-${r.estado}">${ESTADO_LABEL[r.estado] || r.estado}</span></td>
      <td class="actions-cell">${acciones}</td>
    `;
    reservasBody.appendChild(tr);
  });
}

async function cargarReservas(){
  const params = new URLSearchParams();
  if(filtroFecha.value) params.set('fecha', filtroFecha.value);
  if(filtroEstado.value) params.set('estado', filtroEstado.value);
  const data = await apiFetch(`/api/admin/reservas?${params.toString()}`);
  if(data.ok) renderReservas(data.reservas);
}

filtroFecha.addEventListener('change', cargarReservas);
filtroEstado.addEventListener('change', cargarReservas);
document.getElementById('filtros-limpiar').addEventListener('click', () => {
  filtroFecha.value = '';
  filtroEstado.value = '';
  cargarReservas();
});

reservasBody.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action]');
  if(!btn) return;
  const id = btn.dataset.id;

  if(btn.dataset.action === 'confirmar'){
    await apiFetch(`/api/admin/reservas/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ estado: 'confirmada' }),
    });
    cargarReservas();
  }

  if(btn.dataset.action === 'recordatorio'){
    const mensaje = `Hola, solo para recordarte que tienes una cita el ${fechaLegible(btn.dataset.fecha)} a las ${btn.dataset.bloque}, ¿me podrías confirmar por favor?`;
    window.open(`https://wa.me/52${btn.dataset.telefono}?text=${encodeURIComponent(mensaje)}`, '_blank');
  }

  if(btn.dataset.action === 'cancelar'){
    if(!confirm('¿Cancelar esta reserva? El horario quedará libre de inmediato.')) return;
    await apiFetch(`/api/admin/reservas/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ estado: 'cancelada' }),
    });
    cargarReservas();
  }
});

cargarHorarios();
