// ⚠️ URL del servicio backend (API), sin slash final.
const API_BASE_URL = 'https://api.manicura.ankode.cloud';

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

// --- Tabs ---
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    if(btn.dataset.tab === 'reservas') cargarReservas();
  });
});

// --- Logout ---
document.getElementById('logout-btn').addEventListener('click', async () => {
  await apiFetch('/api/admin/logout', { method: 'POST' });
  window.location.href = '/admin/login.html';
});

// --- Horarios ---
const horariosBody = document.getElementById('horarios-body');
const horariosEmpty = document.getElementById('horarios-empty');
const horarioForm = document.getElementById('horario-form');
const horarioError = document.getElementById('horario-error');

function renderHorarios(horarios){
  horariosBody.innerHTML = '';
  horariosEmpty.style.display = horarios.length ? 'none' : 'block';

  horarios.forEach((h) => {
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
    horariosBody.appendChild(tr);
  });
}

async function cargarHorarios(){
  const data = await apiFetch('/api/admin/horarios');
  if(data.ok) renderHorarios(data.horarios);
}

horarioForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  horarioError.classList.remove('show');
  const inicio = document.getElementById('h-inicio').value.trim();
  const fin = document.getElementById('h-fin').value.trim();
  if(!inicio || !fin){
    horarioError.textContent = 'Completa inicio y fin.';
    horarioError.classList.add('show');
    return;
  }
  const data = await apiFetch('/api/admin/horarios', {
    method: 'POST',
    body: JSON.stringify({ inicio, fin }),
  });
  if(!data.ok){
    horarioError.textContent = data.error || 'No se pudo agregar el horario.';
    horarioError.classList.add('show');
    return;
  }
  horarioForm.reset();
  cargarHorarios();
});

horariosBody.addEventListener('click', async (e) => {
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
    if(!confirm('¿Eliminar este horario? Ya no se ofrecerá a clientas.')) return;
    await apiFetch(`/api/admin/horarios/${id}`, { method: 'DELETE' });
    cargarHorarios();
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
    const acciones = r.estado === 'pendiente'
      ? `<button class="btn btn-primary btn-sm" data-action="confirmar" data-id="${r.id}">Confirmar ✓</button>
         <button class="btn btn-danger btn-sm" data-action="cancelar" data-id="${r.id}">Cancelar</button>`
      : '';
    tr.innerHTML = `
      <td>${escapeHtml(r.fecha)}</td>
      <td>${escapeHtml(r.bloque)}</td>
      <td>${escapeHtml(r.nombre_cliente)}</td>
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
