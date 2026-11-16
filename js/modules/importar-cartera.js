/* Cargar la cartera que ya existe (lotes que ya salieron): pegar desde Excel o subir CSV, con vista previa */
import { db, q, money, num, fdate, today, esc, errMsg, toast, withBusy, showError } from '../lib.js';

const MAX_FILAS = 2000;

/* Nombres de columna que se reconocen (sin tildes ni mayúsculas) */
const SINONIMOS = {
  nombre: ['nombre', 'cliente', 'nombre del cliente', 'nombres', 'razon social'],
  telefono: ['telefono', 'celular', 'tel', 'movil', 'whatsapp', 'contacto'],
  direccion: ['direccion', 'dir', 'ubicacion', 'finca'],
  zona: ['zona', 'barrio', 'sector', 'vereda', 'ruta', 'municipio'],
  saldo: ['saldo', 'valor', 'deuda', 'debe', 'pendiente', 'saldo pendiente', 'monto', 'cartera', 'total'],
  fecha: ['fecha', 'fecha de venta', 'fecha venta', 'desde', 'fecha de la deuda'],
  fecha_cobro: ['fecha de cobro', 'fecha cobro', 'fecha pactada', 'pactada', 'vence', 'vencimiento', 'fecha limite', 'fecha de pago', 'cobrar el'],
  lote: ['lote', 'lote de origen', 'n lote', 'no lote', 'numero de lote'],
  observacion: ['observacion', 'observaciones', 'nota', 'notas', 'detalle', 'comentario'],
  documento: ['documento', 'cedula', 'cc', 'nit', 'identificacion'],
};
const ETIQUETA = {
  nombre: 'Nombre', telefono: 'Teléfono', direccion: 'Dirección', zona: 'Zona', saldo: 'Saldo',
  fecha: 'Fecha', fecha_cobro: 'Fecha de cobro', lote: 'Lote', observacion: 'Observación', documento: 'Documento',
};
const ORDEN_COLS = ['nombre', 'telefono', 'direccion', 'zona', 'saldo', 'fecha', 'fecha_cobro', 'lote', 'observacion', 'documento'];

const sinTildes = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/* ---------- Lectura de texto (Excel pegado o CSV) ---------- */
function detectarSeparador(texto) {
  const linea = texto.split(/\r?\n/).find((l) => l.trim()) || '';
  const cuenta = (c) => (linea.match(new RegExp(c === '\t' ? '\t' : `\\${c}`, 'g')) || []).length;
  return [['\t', cuenta('\t')], [';', cuenta(';')], [',', cuenta(',')]].sort((a, b) => b[1] - a[1])[0][1] > 0
    ? [['\t', cuenta('\t')], [';', cuenta(';')], [',', cuenta(',')]].sort((a, b) => b[1] - a[1])[0][0]
    : '\t';
}

/** Lee texto delimitado respetando comillas */
function leerTabla(texto) {
  const t = texto.replace(/^﻿/, '');
  const sep = detectarSeparador(t);
  const filas = []; let fila = []; let celda = ''; let comillas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (comillas) {
      if (c === '"' && t[i + 1] === '"') { celda += '"'; i++; }
      else if (c === '"') comillas = false;
      else celda += c;
    } else if (c === '"') comillas = true;
    else if (c === sep) { fila.push(celda); celda = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      fila.push(celda); celda = '';
      if (fila.some((x) => x.trim() !== '')) filas.push(fila);
      fila = [];
    } else celda += c;
  }
  fila.push(celda);
  if (fila.some((x) => x.trim() !== '')) filas.push(fila);
  return filas;
}

/** Asigna cada columna del archivo a un campo conocido a partir de los encabezados */
function mapearColumnas(encabezado) {
  const mapa = {};
  encabezado.forEach((h, i) => {
    const n = sinTildes(h);
    for (const [campo, lista] of Object.entries(SINONIMOS)) {
      if (!(campo in mapa) && lista.includes(n)) { mapa[campo] = i; break; }
    }
  });
  return mapa;
}

/** "$ 1.500.000", "1,500,000" o "1.500.000,50" → número */
export function leerValor(t) {
  let s = String(t ?? '').replace(/[^\d.,-]/g, '');
  if (!s) return null;
  const neg = s.startsWith('-');
  s = s.replace(/-/g, '');
  const p = s.lastIndexOf('.'); const c = s.lastIndexOf(',');
  if (p >= 0 && c >= 0) {
    const dec = p > c ? '.' : ',';
    s = s.replace(dec === '.' ? /,/g : /\./g, '').replace(dec, '.');
  } else if (p >= 0 || c >= 0) {
    const sep = p >= 0 ? '.' : ',';
    const partes = s.split(sep);
    const miles = partes.length > 2 || (partes.length === 2 && partes[1].length === 3);
    s = miles ? partes.join('') : partes.join('.');
  }
  const n = Number(s);
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

/** 2026-09-10, 10/09/2026, 10-09-26 → 2026-09-10. Si no se entiende, devuelve el texto original para que la base lo marque. */
export function leerFecha(t) {
  const s = String(t ?? '').trim();
  if (!s) return '';
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;   // día/mes/año, como se usa en Colombia
  }
  return s;
}

function aFilas(tabla) {
  if (!tabla.length) return { error: 'No se encontró ningún dato.' };
  const mapa = mapearColumnas(tabla[0]);
  if (!('nombre' in mapa) || !('saldo' in mapa)) {
    return { error: 'La primera fila debe tener los títulos de las columnas, y al menos “Nombre” y “Saldo”. Descarga la plantilla para ver el formato.' };
  }
  const cuerpo = tabla.slice(1);
  if (!cuerpo.length) return { error: 'El archivo solo tiene los títulos; faltan las filas con los clientes.' };
  if (cuerpo.length > MAX_FILAS) return { error: `El archivo tiene ${num(cuerpo.length)} filas y el máximo por carga es ${num(MAX_FILAS)}. Divídelo en partes.` };
  const val = (f, campo) => (campo in mapa ? String(f[mapa[campo]] ?? '').trim() : '');
  const filas = cuerpo.map((f) => {
    const saldo = leerValor(val(f, 'saldo'));
    return {
      nombre: val(f, 'nombre'),
      telefono: val(f, 'telefono'),
      direccion: val(f, 'direccion'),
      zona: val(f, 'zona'),
      documento: val(f, 'documento'),
      saldo: saldo === null ? val(f, 'saldo') : String(saldo),
      fecha: leerFecha(val(f, 'fecha')),
      fecha_cobro: leerFecha(val(f, 'fecha_cobro')),
      lote: val(f, 'lote').replace(/^lote\s*/i, ''),
      observacion: val(f, 'observacion'),
    };
  });
  return { filas, columnas: ORDEN_COLS.filter((c) => c in mapa) };
}

/* ---------- Plantilla ---------- */
function descargarPlantilla() {
  const lineas = [
    'Nombre;Teléfono;Dirección;Zona;Saldo;Fecha;Fecha de cobro;Lote;Observación',
    'Juan Pérez;3001234567;Calle 5 # 10-20;Barrio Centro;1500000;2026-09-15;2026-10-15;2;Cerdos del lote 2',
    'María López;3109876543;Vereda El Prado;El Prado;850000;2026-10-02;2026-11-20;3;',
  ];
  const blob = new Blob(['﻿' + lineas.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'plantilla-cartera.csv';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ---------- Pantalla ---------- */
const ESTADO = {
  ok: { txt: 'Se carga', cls: 'chip-verde' },
  duplicada: { txt: 'Ya estaba cargada', cls: 'chip-ocre' },
  error: { txt: 'Revisar', cls: 'chip-rojo' },
};

export async function render({ root }) {
  const st = { filas: null, prev: null };

  root.innerHTML = `
    <header class="page-head"><div>
      <h1 tabindex="-1">Cargar cartera</h1>
      <p class="sub">Sube la cartera que ya tienes de los lotes que salieron. Primero ves una vista previa; no se guarda nada hasta que confirmes.</p>
    </div></header>

    <section class="pasos" aria-label="Cómo cargar la cartera">
      <ol>
        <li><strong>Arma la lista.</strong> Una fila por cada deuda: cliente, cuánto debe y desde qué fecha. Si un cliente debe de dos ventas, van dos filas.</li>
        <li><strong>Cópiala o súbela.</strong> Pega las filas desde Excel o Google Sheets, o sube un archivo CSV.</li>
        <li><strong>Revisa y confirma.</strong> Te mostramos qué se carga, qué ya estaba y qué hay que corregir.</li>
      </ol>
      <p><button type="button" class="btn btn-suave" id="btn-plantilla">Descargar plantilla de ejemplo</button></p>
      <p class="ayuda">Columnas: <strong>Nombre</strong> y <strong>Saldo</strong> son obligatorias. Opcionales: Teléfono, Dirección, Zona, Fecha de la deuda, <strong>Fecha de cobro</strong> (cuándo acordaron el pago), Lote, Observación y Documento. Si no pones fecha de la deuda, queda la de hoy; si no pones fecha de cobro, el cliente aparece en la ruta de hoy como “Sin fecha de cobro”.</p>
    </section>

    <form id="f-carga" novalidate class="carga">
      <div class="campo"><label for="i-texto">Pega aquí las filas copiadas de Excel (con los títulos de las columnas)</label>
        <textarea id="i-texto" rows="7" spellcheck="false" placeholder="Nombre&#9;Saldo&#9;Fecha&#9;Lote"></textarea></div>
      <div class="campo"><label for="i-archivo">O sube un archivo CSV</label>
        <input id="i-archivo" type="file" accept=".csv,.tsv,.txt,text/csv,text/plain">
        <span class="ayuda">Si tienes un archivo de Excel (.xlsx), ábrelo, selecciona las celdas, cópialas y pégalas arriba; o guárdalo como “CSV” desde Excel.</span></div>
      <p class="error" id="i-error" role="alert" hidden></p>
      <div class="acciones-form"><button type="submit" class="btn btn-primario">Revisar antes de cargar</button></div>
    </form>
    <div id="vista" aria-live="polite"></div>`;

  const $ = (s) => root.querySelector(s);
  const err = $('#i-error');
  const vista = $('#vista');
  $('#btn-plantilla').addEventListener('click', descargarPlantilla);

  $('#i-archivo').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      let texto = await f.text();
      if (texto.includes('�')) texto = new TextDecoder('windows-1252').decode(await f.arrayBuffer());   // CSV de Excel en Windows
      $('#i-texto').value = texto;
      err.hidden = true;
      toast(`Archivo “${f.name}” leído. Pulsa Revisar antes de cargar.`);
    } catch (ex) { showError(err, 'No se pudo leer el archivo. Pega las filas desde Excel.'); }
  });

  $('#f-carga').addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true; vista.innerHTML = '';
    const texto = $('#i-texto').value;
    if (!texto.trim()) return showError(err, 'Pega las filas o sube un archivo primero.');
    const r = aFilas(leerTabla(texto));
    if (r.error) return showError(err, r.error);
    st.filas = r.filas; st.columnas = r.columnas;
    await withBusy($('#f-carga [type=submit]'), async () => {
      try {
        st.prev = await q(db.rpc('importar_cartera', { p_filas: st.filas, p_simular: true }));
        pintarVista();
        vista.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (ex) { showError(err, errMsg(ex)); }
    });
  });

  function pintarVista() {
    const p = st.prev;
    const sinFecha = st.filas.filter((f, i) => !f.fecha && p.detalle[i]?.estado === 'ok').length;
    const hay = Number(p.validas) > 0;
    vista.innerHTML = `
      <h2 class="titulo-vista">Vista previa</h2>
      <dl class="resumen">
        <div><dt>Se van a cargar</dt><dd>${num(p.validas)} ${Number(p.validas) === 1 ? 'deuda' : 'deudas'}</dd></div>
        <div><dt>Saldo total a cargar</dt><dd>${money(p.saldo_total)}</dd></div>
        <div><dt>Clientes nuevos</dt><dd>${num(p.clientes_nuevos)}</dd></div>
        <div><dt>Ya estaban / por corregir</dt><dd>${num(p.duplicadas)} / <span class="${Number(p.errores) ? 'deuda' : ''}">${num(p.errores)}</span></dd></div>
      </dl>
      ${sinFecha ? `<p class="aviso-linea">${sinFecha} ${sinFecha === 1 ? 'deuda no tiene' : 'deudas no tienen'} fecha: quedarán con la fecha de hoy (${fdate(today())}). Si conoces la fecha real, corrígela en el archivo para que la antigüedad de la deuda sea correcta.</p>` : ''}
      ${Number(p.errores) ? '<p class="aviso-linea mal">Hay filas por corregir. Se omiten al cargar; puedes cargar las demás ahora y volver a subir el archivo corregido sin duplicar nada.</p>' : ''}
      <div class="campo filtro-vista"><label for="v-ver">Mostrar</label>
        <select id="v-ver"><option value="todas">Todas las filas</option><option value="error">Solo las que hay que corregir</option><option value="ok">Solo las que se cargan</option></select></div>
      <div class="tabla-wrap"><table class="tabla ancha" id="t-prev">
        <thead><tr><th>Fila</th><th>Cliente</th><th class="der">Saldo</th><th>Fecha</th><th>Lote</th><th>Resultado</th></tr></thead>
        <tbody></tbody></table></div>
      <div class="acciones-form">
        <button type="button" class="btn btn-primario" id="btn-cargar" ${hay ? '' : 'disabled'}>${hay ? `Cargar ${num(p.validas)} ${Number(p.validas) === 1 ? 'deuda' : 'deudas'} (${money(p.saldo_total)})` : 'No hay nada para cargar'}</button>
      </div>
      <p class="error" id="c-error" role="alert" hidden></p>`;
    const filtro = vista.querySelector('#v-ver');
    const pintarFilas = () => {
      const v = filtro.value;
      vista.querySelector('#t-prev tbody').innerHTML = p.detalle
        .filter((d) => v === 'todas' || d.estado === v)
        .map((d) => {
          const e = ESTADO[d.estado] || ESTADO.error;
          return `<tr>
            <td data-label="Fila">${d.fila + 1}</td>
            <td data-label="Cliente" class="ancho">${esc(d.nombre) || '<em>(sin nombre)</em>'}${d.cliente_nuevo ? ' <span class="chip chip-ocre">Nuevo</span>' : ''}</td>
            <td data-label="Saldo" class="der">${d.saldo != null ? money(d.saldo) : ''}</td>
            <td data-label="Fecha">${d.fecha ? fdate(d.fecha) : ''}</td>
            <td data-label="Lote">${d.lote ? `Lote ${esc(d.lote)}` : ''}</td>
            <td data-label="Resultado" class="ancho"><span class="chip ${e.cls}">${e.txt}</span>${d.mensaje ? `<span class="obs">${esc(d.mensaje)}</span>` : ''}</td></tr>`;
        }).join('') || '<tr><td class="ancho" colspan="6">No hay filas en esta vista.</td></tr>';
    };
    filtro.addEventListener('change', pintarFilas);
    if (Number(p.errores)) filtro.value = 'error';
    pintarFilas();

    vista.querySelector('#btn-cargar').addEventListener('click', async (ev) => {
      const cerr = vista.querySelector('#c-error'); cerr.hidden = true;
      await withBusy(ev.currentTarget, async () => {
        try {
          const r = await q(db.rpc('importar_cartera', { p_filas: st.filas, p_simular: false }));
          terminar(r);
        } catch (ex) { showError(cerr, errMsg(ex)); }
      });
    });
  }

  function terminar(r) {
    $('#f-carga').hidden = true;
    root.querySelector('.pasos').hidden = true;
    vista.innerHTML = `<div class="listo">
      <h2>Cartera cargada</h2>
      <p><strong>${num(r.validas)}</strong> ${Number(r.validas) === 1 ? 'deuda' : 'deudas'} por <strong>${money(r.saldo_total)}</strong>
        ${Number(r.clientes_nuevos) ? `, con ${num(r.clientes_nuevos)} ${Number(r.clientes_nuevos) === 1 ? 'cliente nuevo' : 'clientes nuevos'}` : ''}.</p>
      ${Number(r.duplicadas) ? `<p>${num(r.duplicadas)} ya estaban cargadas y no se repitieron.</p>` : ''}
      ${Number(r.errores) ? `<p>${num(r.errores)} ${Number(r.errores) === 1 ? 'fila quedó' : 'filas quedaron'} sin cargar por errores. Corrígelas en el archivo y vuelve a subirlo: lo que ya está cargado no se duplica.</p>` : ''}
      <div class="acciones-form" style="justify-content:flex-start">
        <a class="btn btn-primario" href="#/ruta-cobro">Ir a la ruta de cobro</a>
        <button type="button" class="btn btn-suave" id="btn-otra">Cargar otro archivo</button>
      </div></div>`;
    vista.querySelector('#btn-otra').addEventListener('click', () => location.reload());
    toast('Cartera cargada');
    vista.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
