/* Arranque: sesión, perfil, menú y rutas */
import { db, q, esc, errMsg, resetCache } from './lib.js';
import * as inicio from './modules/inicio.js';
import * as lotes from './modules/lotes.js';
import * as comprasCerdos from './modules/compras-cerdos.js';
import * as rutaCobro from './modules/ruta-cobro.js';
import * as cuentas from './modules/cuentas.js';
import * as ventas from './modules/ventas.js';
import * as bajas from './modules/bajas.js';
import * as sacrificio from './modules/sacrificio.js';
import { render as renderPronto } from './modules/pronto.js';

const NOMBRE_APP = 'Granja porcina';

const MARCA = `<svg viewBox="0 0 64 64" aria-hidden="true">
  <rect width="64" height="64" rx="14" fill="#1F3350"/>
  <circle cx="16" cy="20" r="7" fill="#E27D8B"/><circle cx="48" cy="20" r="7" fill="#E27D8B"/>
  <circle cx="32" cy="34" r="20" fill="#E27D8B"/>
  <ellipse cx="32" cy="39" rx="10.5" ry="8" fill="#F7C2C9"/>
  <ellipse cx="28" cy="39" rx="1.8" ry="2.8" fill="#1F3350"/><ellipse cx="36" cy="39" rx="1.8" ry="2.8" fill="#1F3350"/>
  <circle cx="24" cy="30" r="2.3" fill="#1F3350"/><circle cx="40" cy="30" r="2.3" fill="#1F3350"/>
</svg>`;

const ICONO_MENU = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';

/* Menú. Los módulos sin "mod" todavía no están construidos: se ven, pero abren una pantalla informativa. */
const NAV = [
  { id: 'inicio', titulo: 'Inicio', mod: inicio },
  { grupo: 'Operación', items: [
    { id: 'lotes', titulo: 'Lotes', mod: lotes },
    { id: 'compras-cerdos', titulo: 'Compra de cerdos', mod: comprasCerdos },
    { id: 'alimentos', titulo: 'Compra de alimento', desc: 'Compra de Preinicio, Inicio, Levante, Finalizador, Gestación y Lactancia a Campo Vallenato y Pastal. Toda compra entra a bodega.' },
    { id: 'bodega', titulo: 'Bodega', desc: 'Existencias de alimento y salidas a cada lote, con fecha y cantidad. Cada salida carga su costo al lote.' },
    { id: 'bajas', titulo: 'Bajas', mod: bajas },
    { id: 'sacrificio', titulo: 'Sacrificio', mod: sacrificio },
  ] },
  { grupo: 'Comercial', items: [
    { id: 'ventas', titulo: 'Ventas', mod: ventas },
    { id: 'ruta-cobro', titulo: 'Ruta de cobro', mod: rutaCobro },
  ] },
  { grupo: 'Finanzas', items: [
    { id: 'cuentas', titulo: 'Cuentas', solo: 'dueno', mod: cuentas },
    { id: 'gastos', titulo: 'Gastos', desc: 'Gastos por lote: operativos, medicamentos, gasolina, préstamos al operador y otros.' },
    { id: 'granja', titulo: 'Granja', solo: 'dueno', desc: 'Inversiones de la granja (nevera, báscula, herramientas) que se recuperan poco a poco en cada liquidación.' },
    { id: 'liquidacion', titulo: 'Liquidación', solo: 'dueno', desc: 'Cierre mensual por lotes: ingresos, costos, descuentos y la parte del operador.' },
    { id: 'reportes', titulo: 'Reportes', desc: 'Rentabilidad por lote, ventas por mes, cartera en la calle y más.' },
  ] },
];
const TODOS = NAV.flatMap((n) => n.items || [n]);

const app = document.getElementById('app');
let perfil = null;
let uidActual;          // undefined = aún no se ha arrancado
let shellActivo = false;
let rutaId = 0;

const puede = (item) => !item.solo || perfil?.rol === item.solo;

/* ---------- Pantallas de estado ---------- */
function pantallaSimple(titulo, texto, extra = '') {
  app.innerHTML = `<main class="login"><section class="login-hoja">
    <div class="login-marca">${MARCA}<h1>${esc(titulo)}</h1></div>
    <p class="sub">${texto}</p>${extra}</section></main>`;
}

function pantallaLogin() {
  shellActivo = false;
  app.innerHTML = `<main class="login"><section class="login-hoja">
    <div class="login-marca">${MARCA}<h1>${NOMBRE_APP}</h1></div>
    <p class="sub">Entra con tu correo y contraseña.</p>
    <form id="form-login" novalidate>
      <div class="campo"><label for="email">Correo</label>
        <input id="email" type="email" inputmode="email" autocomplete="username" required></div>
      <div class="campo"><label for="clave">Contraseña</label>
        <input id="clave" type="password" autocomplete="current-password" required></div>
      <p class="error" id="login-error" role="alert" hidden></p>
      <button class="btn btn-primario" type="submit">Entrar</button>
    </form>
    <p class="firma">Desarrollado por DHSoftwareData</p>
  </section></main>`;

  const form = document.getElementById('form-login');
  const err = document.getElementById('login-error');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    const email = form.email.value.trim();
    const clave = form.clave.value;
    if (!email || !clave) { err.textContent = 'Escribe tu correo y tu contraseña.'; err.hidden = false; return; }
    const btn = form.querySelector('button');
    btn.disabled = true; btn.textContent = 'Entrando…';
    const { error } = await db.auth.signInWithPassword({ email, password: clave });
    if (error) {
      err.textContent = errMsg(error); err.hidden = false;
      btn.disabled = false; btn.textContent = 'Entrar';
    }
    // si todo sale bien, onAuthStateChange monta la aplicación
  });
  document.getElementById('email').focus();
}

function pantallaSinAcceso() {
  pantallaSimple('Sin acceso',
    'Tu usuario existe, pero todavía no tiene permiso para usar la granja. Pide al administrador que lo active.',
    '<p style="margin-top:1rem"><button class="btn btn-suave" id="btn-salir">Cerrar sesión</button></p>');
  document.getElementById('btn-salir').addEventListener('click', () => db.auth.signOut());
}

/* ---------- Aplicación ---------- */
const ETIQUETA_ROL = { dueno: 'Dueño', auxiliar: 'Auxiliar' };

function montarShell() {
  const enlace = (i) => `<li><a href="#/${i.id}" data-id="${i.id}"${i.mod ? '' : ' class="pronto"'}>
      <span>${esc(i.titulo)}</span>${i.mod ? '' : '<span class="etq-pronto">Pronto</span>'}</a></li>`;
  const menu = NAV.map((n) => {
    if (!n.items) return puede(n) ? `<ul>${enlace(n)}</ul>` : '';
    const items = n.items.filter(puede);
    return items.length ? `<p class="nav-grupo">${esc(n.grupo)}</p><ul>${items.map(enlace).join('')}</ul>` : '';
  }).join('');

  app.innerHTML = `<div class="shell">
    <header class="topbar">
      <button type="button" class="icono" id="btn-menu" aria-label="Abrir menú" aria-expanded="false" aria-controls="nav">${ICONO_MENU}</button>
      <span class="titulo">${NOMBRE_APP}</span>
    </header>
    <nav class="nav" id="nav" aria-label="Módulos">
      <div class="marca">${MARCA}<span>${NOMBRE_APP}</span></div>
      ${menu}
      <div class="usuario">
        <div class="u-nombre">${esc(perfil.nombre)}</div>
        <div class="u-rol">${esc(ETIQUETA_ROL[perfil.rol] || perfil.rol)}</div>
        <button type="button" class="btn btn-nav" id="btn-salir">Cerrar sesión</button>
      </div>
    </nav>
    <div class="velo" id="velo"></div>
    <main class="principal" id="principal" tabindex="-1"><div id="contenido"></div></main>
  </div>`;
  shellActivo = true;

  const alternar = (abrir) => {
    document.body.classList.toggle('nav-abierto', abrir);
    document.getElementById('btn-menu').setAttribute('aria-expanded', String(abrir));
    document.getElementById('btn-menu').setAttribute('aria-label', abrir ? 'Cerrar menú' : 'Abrir menú');
  };
  document.getElementById('btn-menu').addEventListener('click', () => alternar(!document.body.classList.contains('nav-abierto')));
  document.getElementById('velo').addEventListener('click', () => alternar(false));
  document.getElementById('nav').addEventListener('click', (e) => { if (e.target.closest('a')) alternar(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') alternar(false); });
  document.getElementById('btn-salir').addEventListener('click', () => db.auth.signOut());
}

async function ruta(primera = false) {
  if (!shellActivo) return;
  const id = location.hash.replace(/^#\/?/, '').split('?')[0] || 'inicio';
  const item = TODOS.find((i) => i.id === id && puede(i)) || TODOS[0];
  const mi = ++rutaId;

  document.querySelectorAll('.nav a').forEach((a) => {
    if (a.dataset.id === item.id) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  document.title = `${item.titulo} - ${NOMBRE_APP}`;

  const root = document.createElement('div');
  document.getElementById('contenido').replaceChildren(root);
  window.scrollTo(0, 0);
  root.innerHTML = '<p class="cargando" role="status">Cargando…</p>';

  try {
    if (item.mod) await item.mod.render({ root, perfil });
    else renderPronto({ root, item });
  } catch (e) {
    if (mi !== rutaId) return;
    root.innerHTML = `<div class="vacio"><h2>No se pudo abrir esta pantalla</h2><p>${esc(errMsg(e))}</p>
      <button type="button" class="btn btn-suave" id="reintentar-ruta">Reintentar</button></div>`;
    root.querySelector('#reintentar-ruta').addEventListener('click', () => ruta());
    return;
  }
  if (mi === rutaId && !primera) root.querySelector('h1')?.focus();
}

async function arrancar(session) {
  const uid = session?.user?.id ?? null;
  if (uid === uidActual) return;   // por ejemplo, al volver a la pestaña
  uidActual = uid;
  resetCache();
  document.body.classList.remove('nav-abierto', 'sin-scroll');
  document.querySelectorAll('.modal-fondo').forEach((m) => m.remove());

  if (!uid) { perfil = null; pantallaLogin(); return; }

  app.innerHTML = '<p class="cargando" role="status">Cargando…</p>';
  try {
    perfil = await q(db.from('perfiles').select('nombre,rol,activo').eq('id', uid).maybeSingle());
  } catch (e) {
    pantallaSimple('No se pudo entrar', esc(errMsg(e)),
      '<p style="margin-top:1rem"><button class="btn btn-suave" id="btn-salir">Cerrar sesión</button></p>');
    document.getElementById('btn-salir').addEventListener('click', () => db.auth.signOut());
    return;
  }
  if (!perfil || !perfil.activo) { pantallaSinAcceso(); return; }
  montarShell();
  ruta(true);
}

/* ---------- Inicio ---------- */
(async function init() {
  if (!db) {
    pantallaSimple('Falta la configuración',
      'No se encontró la conexión con Supabase. Revisa que los Secrets <strong>SUPABASE_URL</strong> y <strong>SUPABASE_ANON_KEY</strong> estén creados en el repositorio y vuelve a publicar.');
    return;
  }
  window.addEventListener('hashchange', () => ruta());
  db.auth.onAuthStateChange((evento, session) => {
    if (evento === 'SIGNED_IN' || evento === 'SIGNED_OUT') setTimeout(() => arrancar(session), 0);
  });
  const { data } = await db.auth.getSession();
  await arrancar(data.session);
})();
