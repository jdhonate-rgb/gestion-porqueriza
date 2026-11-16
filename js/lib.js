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

/** Fecha de hoy en Colombia como YYYY-MM-DD (igual que hoy_co() en la base, sin importar la zona del dispositivo) */
export function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

/** Suma días a una fecha ISO (YYYY-MM-DD) */
export function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const f = new Date(Date.UTC(y, m - 1, d + n));
  return f.toISOString().slice(0, 10);
}

/** "hoy", "ayer", "hace 12 días" a partir de una fecha ISO */
export function haceTxt(iso) {
  if (!iso) return '';
  const [y1, m1, d1] = today().split('-').map(Number);
  const [y2, m2, d2] = String(iso).slice(0, 10).split('-').map(Number);
  const n = Math.round((Date.UTC(y1, m1 - 1, d1) - Date.UTC(y2, m2 - 1, d2)) / 86400000);
  if (n === 0) return 'hoy';
  if (n === 1) return 'ayer';
  if (n === -1) return 'mañana';
  return n > 0 ? `hace ${n} días` : `en ${-n} días`;
}

/* ---------- Enlaces de contacto ---------- */
const soloDigitos = (t) => String(t ?? '').replace(/\D/g, '');
export const telLink = (t) => (soloDigitos(t).length >= 7 ? `tel:${soloDigitos(t)}` : '');
export function waLink(t, texto = '') {
  let d = soloDigitos(t);
  if (d.length < 7) return '';
  if (d.length === 10 && d.startsWith('3')) d = '57' + d;   // celular colombiano sin indicativo
  return `https://wa.me/${d}${texto ? `?text=${encodeURIComponent(texto)}` : ''}`;
}
export const mapsLink = (...partes) => {
  const t = partes.filter(Boolean).join(', ').trim();
  return t ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(t)}` : '';
};

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

/* ---------- Confirmación antes de borrar ---------- */
/** Pregunta antes de una acción que no se puede deshacer. Devuelve true si el usuario confirma. */
export function confirmar({ titulo, texto, boton = 'Eliminar' }) {
  return new Promise((resolve) => {
    let respondido = false;
    const m = modal({
      title: titulo,
      html: `<p class="confirma-texto">${texto}</p>
        <div class="acciones-form">
          <button type="button" class="btn btn-suave" data-cerrar>Cancelar</button>
          <button type="button" class="btn btn-peligro" id="btn-confirmar">${esc(boton)}</button>
        </div>`,
    });
    const fondo = m.el.closest('.modal-fondo');
    m.el.querySelector('#btn-confirmar').addEventListener('click', () => { respondido = true; resolve(true); m.close(); });
    new MutationObserver(() => { if (!fondo.isConnected && !respondido) { respondido = true; resolve(false); } })
      .observe(document.body, { childList: true });
  });
}

/* ---------- Iconos ---------- */
const ico = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const ICONOS = {
  llamar: ico('<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>'),
  whatsapp: ico('<path d="M4 20l1.3-4.2A8 8 0 1 1 8.4 18.8z"/><path d="M9 9.5c.3 2.3 2.2 4.2 4.5 4.5l1.2-1.2-1.8-1-.8.6a3 3 0 0 1-1.5-1.5l.6-.8-1-1.8z"/>'),
  mapa: ico('<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>'),
  cobro: ico('<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6.5 9.5v.01M17.5 14.5v.01"/>'),
};
