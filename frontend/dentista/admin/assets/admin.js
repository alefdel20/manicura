// ⚠️ URL del servicio backend (API), sin slash final.
const API_BASE_URL = 'https://backen-general.ankode.cloud/api/dentista';

// Siempre devuelve { ok, ... } o { ok:false, error } — nunca lanza ni deja
// una promesa rechazada sin manejar, para que cada formulario que ya revisa
// `if(!data.ok)` muestre el error en vez de quedarse "cargando" en silencio.
async function apiFetch(path, options){
  let res;
  try{
    res = await fetch(`${API_BASE_URL}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      ...options,
    });
  }catch(err){
    return { ok: false, error: 'No se pudo conectar con el servidor. Intenta de nuevo.' };
  }

  if(res.status === 401){
    window.location.href = '/dentista/admin/login.html';
    return { ok: false, error: 'No autorizado.' };
  }

  try{
    return await res.json();
  }catch(err){
    return { ok: false, error: `El servidor respondió con un error (${res.status}).` };
  }
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

// --- Sesión / rol ---
// El panel muestra pestañas distintas según quién entró: la cuenta de
// "clínica" administra el roster de dentistas y el catálogo compartido; la
// cuenta de un dentista solo administra su propia agenda y citas.
let sesion = { rol: null, dentistaId: null };

const TABS_POR_ROL = {
  clinica: ['dentistas', 'tratamientos', 'citas'],
  dentista: ['mi-horario', 'mis-tratamientos', 'citas'],
};

// --- Logout ---
document.getElementById('logout-btn').addEventListener('click', async () => {
  await apiFetch('/admin/logout', { method: 'POST' });
  window.location.href = '/dentista/admin/login.html';
});

function activarTab(tab){
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
  document.getElementById(`tab-btn-${tab}`).classList.add('active');
  document.getElementById(`tab-${tab}`).classList.add('active');

  if(tab === 'citas') cargarCitas();
  if(tab === 'dentistas') cargarDentistas();
  if(tab === 'tratamientos') cargarTratamientosClinica();
  if(tab === 'mi-horario') { cargarHorarios(); cargarBloqueos(); }
  if(tab === 'mis-tratamientos') cargarMisTratamientos();
}

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => activarTab(btn.dataset.tab));
});

async function iniciarPanel(){
  const data = await apiFetch('/admin/me');
  if(!data.ok) return; // apiFetch ya redirige a login en 401

  sesion.rol = data.rol;
  sesion.dentistaId = data.dentista ? data.dentista.id : null;

  const who = document.getElementById('who');
  const lede = document.getElementById('dashboard-lede');
  const filtroDentistaWrap = document.getElementById('filtro-dentista-wrap');

  if(data.rol === 'clinica'){
    who.textContent = `${data.usuario} · cuenta de clínica`;
    lede.textContent = 'Da de alta a tus dentistas, administra el catálogo de tratamientos y supervisa todas las citas.';
    filtroDentistaWrap.style.display = '';
    cargarFiltroDentistas();
  } else {
    who.textContent = `${data.usuario} · ${data.dentista ? data.dentista.nombre : 'dentista'}`;
    lede.textContent = 'Define tu horario, elige qué tratamientos ofreces y gestiona tus citas.';
    filtroDentistaWrap.style.display = 'none';
  }

  const disponibles = TABS_POR_ROL[data.rol] || [];
  disponibles.forEach((tab) => document.getElementById(`tab-btn-${tab}`).classList.add('available'));
  activarTab(disponibles[0]);
}

// --- Dentistas (solo cuenta de clínica) ---
const dentistasBody = document.getElementById('dentistas-body');
const dentistasEmpty = document.getElementById('dentistas-empty');
const dentistaForm = document.getElementById('dentista-form');
const dentistaError = document.getElementById('dentista-error');

function renderDentistas(dentistas){
  dentistasBody.innerHTML = '';
  dentistasEmpty.style.display = dentistas.length ? 'none' : 'block';

  dentistas.forEach((d) => {
    const tr = document.createElement('tr');
    if(!d.activo) tr.classList.add('inactivo');
    tr.innerHTML = `
      <td>${escapeHtml(d.nombre)}</td>
      <td>${escapeHtml(d.especialidad || '—')}</td>
      <td><span class="chip ${d.activo ? 'chip-confirmada' : 'chip-cancelada'}">${d.activo ? 'Activo' : 'Inactivo'}</span></td>
      <td class="actions-cell">
        <button class="btn btn-ghost btn-sm" data-action="toggle" data-id="${d.id}" data-activo="${d.activo}">${d.activo ? 'Desactivar' : 'Activar'}</button>
        <button class="btn btn-danger btn-sm" data-action="eliminar" data-id="${d.id}">Eliminar</button>
      </td>
    `;
    dentistasBody.appendChild(tr);
  });
}

async function cargarDentistas(){
  const data = await apiFetch('/admin/dentistas');
  if(data.ok) renderDentistas(data.dentistas);
}

async function cargarFiltroDentistas(){
  const data = await apiFetch('/admin/dentistas');
  if(!data.ok) return;
  const select = document.getElementById('f-dentista');
  select.innerHTML = '<option value="">Todos</option>' + data.dentistas.map((d) =>
    `<option value="${d.id}">${escapeHtml(d.nombre)}</option>`
  ).join('');
}

dentistaForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  dentistaError.classList.remove('show');
  const nombre = document.getElementById('d-nombre').value.trim();
  const especialidad = document.getElementById('d-especialidad').value.trim();
  const bio = document.getElementById('d-bio').value.trim();
  const usuario = document.getElementById('d-usuario').value.trim();
  const password = document.getElementById('d-password').value;

  if(!nombre || !usuario || !password){
    dentistaError.textContent = 'Completa nombre, usuario y password.';
    dentistaError.classList.add('show');
    return;
  }

  const data = await apiFetch('/admin/dentistas', {
    method: 'POST',
    body: JSON.stringify({ nombre, especialidad, bio, usuario, password }),
  });
  if(!data.ok){
    dentistaError.textContent = data.error || 'No se pudo crear el dentista.';
    dentistaError.classList.add('show');
    return;
  }
  dentistaForm.reset();
  cargarDentistas();
  cargarFiltroDentistas();
});

dentistasBody.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action]');
  if(!btn) return;
  const id = btn.dataset.id;

  if(btn.dataset.action === 'toggle'){
    const activo = btn.dataset.activo === '1' || btn.dataset.activo === 'true';
    await apiFetch(`/admin/dentistas/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ activo: !activo }),
    });
    cargarDentistas();
    cargarFiltroDentistas();
  }

  if(btn.dataset.action === 'eliminar'){
    if(!confirm('¿Eliminar este dentista? Perderá acceso al panel de inmediato. Sus citas ya hechas se conservan en el historial.')) return;
    await apiFetch(`/admin/dentistas/${id}`, { method: 'DELETE' });
    cargarDentistas();
    cargarFiltroDentistas();
  }
});

// --- Catálogo de tratamientos (solo cuenta de clínica) ---
const tratamientosBody = document.getElementById('tratamientos-body');
const tratamientosEmpty = document.getElementById('tratamientos-empty');
const tratamientoForm = document.getElementById('tratamiento-form');
const tratamientoError = document.getElementById('tratamiento-error');

function renderTratamientosClinica(tratamientos){
  tratamientosBody.innerHTML = '';
  tratamientosEmpty.style.display = tratamientos.length ? 'none' : 'block';

  tratamientos.forEach((t) => {
    const tr = document.createElement('tr');
    if(!t.activo) tr.classList.add('inactivo');
    tr.innerHTML = `
      <td>${escapeHtml(t.nombre)}</td>
      <td>$${t.precio} MXN</td>
      <td>${t.duracion_minutos} min</td>
      <td><span class="chip ${t.activo ? 'chip-confirmada' : 'chip-cancelada'}">${t.activo ? 'Activo' : 'Inactivo'}</span></td>
      <td class="actions-cell">
        <button class="btn btn-ghost btn-sm" data-action="toggle" data-id="${t.id}" data-activo="${t.activo}">${t.activo ? 'Desactivar' : 'Activar'}</button>
        <button class="btn btn-danger btn-sm" data-action="eliminar" data-id="${t.id}">Eliminar</button>
      </td>
    `;
    tratamientosBody.appendChild(tr);
  });
}

async function cargarTratamientosClinica(){
  const data = await apiFetch('/admin/tratamientos');
  if(data.ok) renderTratamientosClinica(data.tratamientos);
}

tratamientoForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  tratamientoError.classList.remove('show');
  const nombre = document.getElementById('t-nombre').value.trim();
  const precio = document.getElementById('t-precio').value;
  const duracion = document.getElementById('t-duracion').value;
  if(!nombre || !precio || !duracion){
    tratamientoError.textContent = 'Completa nombre, precio y duración.';
    tratamientoError.classList.add('show');
    return;
  }

  const data = await apiFetch('/admin/tratamientos', {
    method: 'POST',
    body: JSON.stringify({ nombre, precio: Number(precio), duracion_minutos: Number(duracion) }),
  });
  if(!data.ok){
    tratamientoError.textContent = data.error || 'No se pudo agregar el tratamiento.';
    tratamientoError.classList.add('show');
    return;
  }
  tratamientoForm.reset();
  cargarTratamientosClinica();
});

tratamientosBody.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action]');
  if(!btn) return;
  const id = btn.dataset.id;

  if(btn.dataset.action === 'toggle'){
    const activo = btn.dataset.activo === '1' || btn.dataset.activo === 'true';
    await apiFetch(`/admin/tratamientos/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ activo: !activo }),
    });
    cargarTratamientosClinica();
  }

  if(btn.dataset.action === 'eliminar'){
    if(!confirm('¿Eliminar este tratamiento del catálogo?')) return;
    await apiFetch(`/admin/tratamientos/${id}`, { method: 'DELETE' });
    cargarTratamientosClinica();
  }
});

// --- Mis tratamientos (solo cuenta de dentista) ---
const misTratamientosList = document.getElementById('mis-tratamientos-list');
const misTratamientosError = document.getElementById('mis-tratamientos-error');
const misTratamientosOk = document.getElementById('mis-tratamientos-ok');

async function cargarMisTratamientos(){
  misTratamientosError.classList.remove('show');
  misTratamientosOk.classList.remove('show');
  const [catalogo, propios] = await Promise.all([
    apiFetch('/admin/tratamientos'),
    apiFetch(`/admin/dentistas/${sesion.dentistaId}/tratamientos`),
  ]);
  if(!catalogo.ok || !propios.ok){
    misTratamientosList.innerHTML = '';
    misTratamientosError.textContent = 'No se pudo cargar el catálogo.';
    misTratamientosError.classList.add('show');
    return;
  }

  const activos = new Set(propios.tratamiento_ids);
  const disponibles = catalogo.tratamientos.filter((t) => t.activo);

  if(!disponibles.length){
    misTratamientosList.innerHTML = '<p class="empty">La clínica todavía no agrega tratamientos al catálogo.</p>';
    return;
  }

  misTratamientosList.innerHTML = `<div class="checklist">${disponibles.map((t) => `
    <label>
      <input type="checkbox" value="${t.id}" ${activos.has(t.id) ? 'checked' : ''}>
      ${escapeHtml(t.nombre)}
      <span class="precio">$${t.precio} MXN · ${t.duracion_minutos} min</span>
    </label>
  `).join('')}</div>`;
}

document.getElementById('mis-tratamientos-guardar').addEventListener('click', async () => {
  misTratamientosError.classList.remove('show');
  misTratamientosOk.classList.remove('show');
  const ids = Array.from(misTratamientosList.querySelectorAll('input[type="checkbox"]:checked')).map((i) => Number(i.value));

  const data = await apiFetch(`/admin/dentistas/${sesion.dentistaId}/tratamientos`, {
    method: 'PUT',
    body: JSON.stringify({ tratamiento_ids: ids }),
  });
  if(!data.ok){
    misTratamientosError.textContent = data.error || 'No se pudo guardar.';
    misTratamientosError.classList.add('show');
    return;
  }
  misTratamientosOk.classList.add('show');
});

// --- Mi horario (vista semanal, solo cuenta de dentista) ---
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

// Si la PÁGINA hace scroll con el menú abierto, se cierra en vez de quedar
// desalineado (su posición se calcula solo al abrirse). El scroll dentro del
// propio menú (para ver más horas) no debe cerrarlo.
window.addEventListener('scroll', (e) => {
  if(!timeDropdownInput) return;
  if(e.target === timeDropdown || timeDropdown.contains(e.target)) return;
  cerrarTimeDropdown();
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

// Si el campo ya estaba enfocado (p.ej. el menú se cerró por scroll), el
// foco no se vuelve a disparar — un clic debe poder reabrir el menú igual.
horariosSemana.addEventListener('click', (e) => {
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
  const data = await apiFetch('/admin/horarios');
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
  const inicioMin = horaAMinutos(inicio);
  const finMin = horaAMinutos(fin);
  if(inicioMin === null || finMin === null){
    errorEl.textContent = 'Formato de hora inválido.';
    errorEl.classList.add('show');
    return;
  }
  if(finMin <= inicioMin){
    errorEl.textContent = 'La hora de fin debe ser después de la de inicio.';
    errorEl.classList.add('show');
    return;
  }

  const data = await apiFetch('/admin/horarios', {
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
    await apiFetch(`/admin/horarios/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ activo: !activo }),
    });
    cargarHorarios();
  }

  if(btn.dataset.action === 'eliminar'){
    if(!confirm('¿Eliminar este bloque? Ya no se ofrecerá a pacientes.')) return;
    await apiFetch(`/admin/horarios/${id}`, { method: 'DELETE' });
    cargarHorarios();
  }
});

// --- Fechas bloqueadas (vacaciones, solo cuenta de dentista) ---
const bloqueosBody = document.getElementById('bloqueos-body');
const bloqueosEmpty = document.getElementById('bloqueos-empty');
const bloqueoForm = document.getElementById('bloqueo-form');
const bloqueoError = document.getElementById('bloqueo-error');

function renderBloqueos(dias){
  bloqueosBody.innerHTML = '';
  bloqueosEmpty.style.display = dias.length ? 'none' : 'block';

  dias.forEach((d) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(d.fecha_inicio)}</td>
      <td>${escapeHtml(d.fecha_fin)}</td>
      <td>${escapeHtml(d.motivo || '—')}</td>
      <td class="actions-cell">
        <button class="btn btn-danger btn-sm" data-action="eliminar" data-id="${d.id}">Eliminar</button>
      </td>
    `;
    bloqueosBody.appendChild(tr);
  });
}

async function cargarBloqueos(){
  const data = await apiFetch('/admin/dias-bloqueados');
  if(data.ok) renderBloqueos(data.dias);
}

bloqueoForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  bloqueoError.classList.remove('show');
  const desde = document.getElementById('b-desde').value;
  const hasta = document.getElementById('b-hasta').value;
  const motivo = document.getElementById('b-motivo').value.trim();
  if(!desde || !hasta){
    bloqueoError.textContent = 'Elige la fecha de inicio y de fin.';
    bloqueoError.classList.add('show');
    return;
  }
  if(hasta < desde){
    bloqueoError.textContent = 'La fecha final debe ser igual o posterior a la inicial.';
    bloqueoError.classList.add('show');
    return;
  }

  const data = await apiFetch('/admin/dias-bloqueados', {
    method: 'POST',
    body: JSON.stringify({ fecha_inicio: desde, fecha_fin: hasta, motivo }),
  });
  if(!data.ok){
    bloqueoError.textContent = data.error || 'No se pudo bloquear esa fecha.';
    bloqueoError.classList.add('show');
    return;
  }
  bloqueoForm.reset();
  cargarBloqueos();
});

bloqueosBody.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action]');
  if(!btn || btn.dataset.action !== 'eliminar') return;
  if(!confirm('¿Quitar este bloqueo? Esas fechas volverán a estar disponibles según el horario normal.')) return;
  await apiFetch(`/admin/dias-bloqueados/${btn.dataset.id}`, { method: 'DELETE' });
  cargarBloqueos();
});

// --- Citas ---
const citasBody = document.getElementById('citas-body');
const citasEmpty = document.getElementById('citas-empty');
const filtroDentista = document.getElementById('f-dentista');
const filtroFecha = document.getElementById('f-fecha');
const filtroEstado = document.getElementById('f-estado');

const ESTADO_LABEL = {
  pendiente: 'Pendiente',
  confirmada: 'Confirmada',
  expirada: 'Expirada',
  cancelada: 'Cancelada',
};

function renderCitas(citas){
  citasBody.innerHTML = '';
  citasEmpty.style.display = citas.length ? 'none' : 'block';

  citas.forEach((c) => {
    const tr = document.createElement('tr');
    tr.classList.add(`estado-${c.estado}`);

    let acciones = '';
    if(c.estado === 'pendiente'){
      acciones += `<button class="btn btn-primary btn-sm" data-action="confirmar" data-id="${c.id}">Confirmar ✓</button>`;
      if(c.telefono){
        acciones += `<button class="btn btn-ghost btn-sm" data-action="recordatorio" data-fecha="${escapeHtml(c.fecha)}" data-bloque="${escapeHtml(c.bloque)}" data-telefono="${escapeHtml(c.telefono)}">Enviar recordatorio</button>`;
      }
      acciones += `<button class="btn btn-danger btn-sm" data-action="cancelar" data-id="${c.id}">Cancelar</button>`;
    }

    const tratamientoTexto = c.tratamiento_nombre ? `${c.tratamiento_nombre} ($${c.tratamiento_precio} MXN)` : '—';

    tr.innerHTML = `
      <td>${escapeHtml(c.fecha)}</td>
      <td>${escapeHtml(c.bloque)}</td>
      <td>${escapeHtml(c.dentista_nombre)}</td>
      <td>${escapeHtml(c.nombre_paciente)}</td>
      <td>${escapeHtml(c.telefono || '—')}</td>
      <td>${escapeHtml(tratamientoTexto)}</td>
      <td>${escapeHtml(c.comentario || '—')}</td>
      <td><span class="chip chip-${c.estado}">${ESTADO_LABEL[c.estado] || c.estado}</span></td>
      <td class="actions-cell">${acciones}</td>
    `;
    citasBody.appendChild(tr);
  });
}

async function cargarCitas(){
  const params = new URLSearchParams();
  if(sesion.rol === 'clinica' && filtroDentista.value) params.set('dentista_id', filtroDentista.value);
  if(filtroFecha.value) params.set('fecha', filtroFecha.value);
  if(filtroEstado.value) params.set('estado', filtroEstado.value);
  const data = await apiFetch(`/admin/citas?${params.toString()}`);
  if(data.ok) renderCitas(data.citas);
}

filtroDentista.addEventListener('change', cargarCitas);
filtroFecha.addEventListener('change', cargarCitas);
filtroEstado.addEventListener('change', cargarCitas);
document.getElementById('filtros-limpiar').addEventListener('click', () => {
  filtroDentista.value = '';
  filtroFecha.value = '';
  filtroEstado.value = '';
  cargarCitas();
});

citasBody.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action]');
  if(!btn) return;
  const id = btn.dataset.id;

  if(btn.dataset.action === 'confirmar'){
    await apiFetch(`/admin/citas/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ estado: 'confirmada' }),
    });
    cargarCitas();
  }

  if(btn.dataset.action === 'recordatorio'){
    const mensaje = `Hola, solo para recordarte que tienes una cita dental el ${fechaLegible(btn.dataset.fecha)} a las ${btn.dataset.bloque}, ¿me podrías confirmar por favor?`;
    window.open(`https://wa.me/52${btn.dataset.telefono}?text=${encodeURIComponent(mensaje)}`, '_blank');
  }

  if(btn.dataset.action === 'cancelar'){
    if(!confirm('¿Cancelar esta cita? El horario quedará libre de inmediato.')) return;
    await apiFetch(`/admin/citas/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ estado: 'cancelada' }),
    });
    cargarCitas();
  }
});

iniciarPanel();
