/* Utilidades compartidas por todos los módulos */

// supabaseClient lo define config.js (script clásico cargado antes de este módulo)
export const db = typeof supabaseClient !== 'undefined' ? supabaseClient : null;

/* ---------- Formatos ---------- */
const fmtCOP = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
const fmtNum = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 });
const fmtFecha = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });

export const money = (n) => fmtCOP.format(Number(n) || 0);
export const num = (n) => fmtNum.format(Number(n) || 0);

export function fdate(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  const p = Object.fromEntries(fmtFecha.formatToParts(new Date(y, m - 1, d)).map((x) => [x.type, x.value]));
  return `${p.day} ${p.month.replace('.', '')} ${p.year}`;
}

/** Fecha de hoy (hora local del dispositivo) como YYYY-MM-DD */
export function today() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

/** Escapa texto para meterlo en HTML. Úsalo con todo dato que venga del usuario o de la base. */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/* ---------- Datos ---------- */
/** Espera una consulta de supabase-js y lanza el error si lo hay. */
export async function q(builder) {
  const { data, error } = await builder;
  if (error) throw error;
  return data;
}

export function errMsg(e) {
  const m = (e && e.message) || String(e);
  if (/row-level security/i.test(m)) return 'Tu usuario no tiene permiso para esta acción.';
  if (/failed to fetch|networkerror|load failed/i.test(m)) return 'No hay conexión con el servidor. Revisa el internet e inténtalo de nuevo.';
  if (/invalid login credentials/i.test(m)) return 'Correo o contraseña incorrectos.';
  return m;
}

let _lotes = null;
export async function getLotes() {
  if (!_lotes) _lotes = await q(db.from('lotes').select('id,nombre,tipo').eq('activo', true).order('id'));
  return _lotes;
}
export function resetCache() { _lotes = null; }

/* ---------- Mensajes en pantalla ---------- */
export const loading = () => '<p class="cargando" role="status">Cargando…</p>';

export function errorHtml(e) {
  return `<div class="vacio"><h2>No se pudieron cargar los datos</h2><p>${esc(errMsg(e))}</p>
    <button type="button" class="btn btn-suave" data-reintentar>Reintentar</button></div>`;
}

export function toast(msg, tipo = 'ok') {
  const cont = document.getElementById('avisos');
  if (!cont) return;
  cont.replaceChildren();   // un aviso a la vez
  const el = document.createElement('div');
  el.className = 'aviso' + (tipo === 'mal' ? ' mal' : '');
  el.textContent = msg;
  cont.appendChild(el);
  setTimeout(() => el.remove(), tipo === 'mal' ? 6000 : 3500);
}

export function showError(el, msg) {
  el.textContent = msg;
  el.hidden = false;
}

/** Desactiva el botón mientras se guarda, para evitar dobles envíos. */
export async function withBusy(btn, fn) {
  const texto = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Guardando…';
  try { return await fn(); }
  finally { btn.disabled = false; btn.textContent = texto; }
}

/* ---------- Campos de dinero ---------- */
const miles = new Intl.NumberFormat('es-CO');
export function bindMoney(input) {
  input.addEventListener('input', () => {
    const d = input.value.replace(/\D/g, '');
    input.value = d ? miles.format(Number(d)) : '';
  });
}
export const readMoney = (input) => Number((input.value || '').replace(/\D/g, '')) || 0;
export const setMoney = (input, n) => { input.value = n > 0 ? miles.format(Math.round(n)) : ''; };

/* ---------- Ventana modal ---------- */
const ICONO_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

export function modal({ title, html, wide = false }) {
  const anterior = document.activeElement;
  const fondo = document.createElement('div');
  fondo.className = 'modal-fondo';
  fondo.innerHTML = `
    <div class="modal${wide ? ' modal-ancho' : ''}" role="dialog" aria-modal="true" aria-labelledby="modal-titulo">
      <header class="modal-cab">
        <h2 id="modal-titulo">${esc(title)}</h2>
        <button type="button" class="icono" data-cerrar aria-label="Cerrar">${ICONO_X}</button>
      </header>
      <div class="modal-cuerpo">${html}</div>
    </div>`;
  document.body.appendChild(fondo);
  document.body.classList.add('sin-scroll');

  const cuerpo = fondo.querySelector('.modal-cuerpo');
  const caja = fondo.querySelector('.modal');

  function cerrar() {
    document.removeEventListener('keydown', teclas);
    fondo.remove();
    if (!document.querySelector('.modal-fondo')) document.body.classList.remove('sin-scroll');
    if (anterior && anterior.focus) anterior.focus();
  }
  function teclas(e) {
    if (fondo !== document.querySelector('.modal-fondo:last-of-type')) return;
    if (e.key === 'Escape') { e.preventDefault(); cerrar(); return; }
    if (e.key !== 'Tab') return;
    const foco = [...caja.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select,textarea')]
      .filter((n) => n.offsetParent !== null);
    if (!foco.length) return;
    const primero = foco[0], ultimo = foco[foco.length - 1];
    if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
    else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
  }
  document.addEventListener('keydown', teclas);
  fondo.addEventListener('click', (e) => {
    if (e.target === fondo || e.target.closest('[data-cerrar]')) cerrar();
  });

  const inicial = cuerpo.querySelector('input:not([type=hidden]):not([readonly]), select, textarea');
  (inicial || caja.querySelector('[data-cerrar]')).focus();

  return { el: cuerpo, close: cerrar, setBody(h) { cuerpo.innerHTML = h; } };
}
