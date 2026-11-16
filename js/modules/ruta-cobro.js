/* Ruta de cobro: tarjeta por cliente, cobros, visitas, ruta del día y cartera */
import {
  db, q, money, num, fdate, today, haceTxt, esc, errMsg, toast, modal, errorHtml, loading,
  bindMoney, readMoney, setMoney, withBusy, showError, getLotes, telLink, waLink, mapsLink,
} from '../lib.js';

const METODO = { efectivo: 'Efectivo', transferencia: 'Transferencia' };
const RESULTADO = {
  cobro: 'Cobro', promesa: 'Prometió pagar', no_estaba: 'No estaba', no_pago: 'No pagó', otro: 'Otro',
};

const radiosMetodo = `
  <fieldset class="segmento campo"><legend>Método de pago</legend>
    <div class="opciones">
      <label><input type="radio" name="metodo" value="efectivo" checked><span>Efectivo</span></label>
      <label><input type="radio" name="metodo" value="transferencia"><span>Transferencia</span></label>
    </div>
  </fieldset>`;

/** Estado que se muestra en la tarjeta (una sola etiqueta, la más importante) */
function estadoCliente(r) {
  const hoy = today();
  if (Number(r.cobrado_hoy) > 0) return { txt: `Cobró hoy ${money(r.cobrado_hoy)}`, cls: 'chip-verde' };
  if (r.promesa_fecha && r.promesa_fecha < hoy) return { txt: `Promesa vencida (${fdate(r.promesa_fecha)})`, cls: 'chip-rojo' };
  if (r.promesa_fecha) return { txt: r.promesa_fecha === hoy ? 'Prometió pagar hoy' : `Promete pagar el ${fdate(r.promesa_fecha)}`, cls: 'chip-ocre' };
  if (r.visitas_hoy > 0 && r.ultima_visita_resultado === 'no_estaba') return { txt: 'No estaba hoy', cls: 'chip-ocre' };
  if (Number(r.dias_deuda) > 30) return { txt: `${r.dias_deuda} días de deuda`, cls: 'chip-rojo' };
  if (Number(r.saldo_total) > 0) return { txt: 'Con saldo', cls: 'chip-ocre' };
  return { txt: 'Al día', cls: 'chip-verde' };
}

/** Prioridad para ordenar: promesas vencidas primero, luego la deuda más vieja y el saldo mayor */
function prioridad(r) {
  const hoy = today();
  const vencida = r.promesa_fecha && r.promesa_fecha < hoy ? 1e9 : 0;
  return vencida + (Number(r.dias_deuda) || 0) * 1000 + Number(r.saldo_total) / 1e6;
}

export async function render({ root }) {
  const lotes = await getLotes();
  const st = { tab: 'ruta', rows: [], buscar: '', zona: '', estado: '', orden: 'prioridad' };
  let carga = 0;

  root.innerHTML = `
    <header class="page-head">
      <div>
        <h1 tabindex="-1">Ruta de cobro</h1>
        <p class="sub">Arma la ruta del día, cobra cliente por cliente y deja anotado qué pasó en cada visita.</p>
      </div>
      <div class="acciones-cab">
        <a class="btn btn-suave" href="#/importar-cartera">Cargar cartera</a>
        <button type="button" class="btn btn-primario" id="btn-cliente">Nuevo cliente</button>
      </div>
    </header>
    <div id="resumen"></div>
    <div class="tabs" role="tablist" aria-label="Secciones">
      <button type="button" role="tab" id="tab-ruta" aria-selected="true" aria-controls="panel">Ruta de hoy</button>
      <button type="button" role="tab" id="tab-todos" aria-selected="false" aria-controls="panel">Todos los clientes con saldo</button>
    </div>
    <div id="panel" role="tabpanel"></div>`;

  const panel = root.querySelector('#panel');
  const resumen = root.querySelector('#resumen');

  root.querySelectorAll('[role=tab]').forEach((t) => t.addEventListener('click', () => {
    st.tab = t.id === 'tab-todos' ? 'todos' : 'ruta';
    root.querySelectorAll('[role=tab]').forEach((x) => x.setAttribute('aria-selected', String(x === t)));
    pintar();
  }));
  root.querySelector('#btn-cliente').addEventListener('click', () => abrirNuevoCliente());

  /* ---------- Carga ---------- */
  async function cargar(silencioso = false) {
    const mi = ++carga;
    if (!silencioso) panel.innerHTML = loading();
    try {
      const filas = await q(db.from('v_ruta_cobro').select('*').range(0, 4999));
      if (mi !== carga) return;
      st.rows = filas;
      pintar();
    } catch (e) {
      if (mi === carga) panel.innerHTML = errorHtml(e);
    }
  }
  panel.addEventListener('click', (e) => {
    if (e.target.closest('[data-reintentar]')) { cargar(); return; }
    manejarAccion(e);
  });

  /* ---------- Pintar ---------- */
  function pintarResumen() {
    const hoy = today();
    const conSaldo = st.rows.filter((r) => Number(r.saldo_total) > 0);
    const cartera = conSaldo.reduce((a, r) => a + Number(r.saldo_total), 0);
    const cobrado = st.rows.reduce((a, r) => a + Number(r.cobrado_hoy), 0);
    const vencidas = conSaldo.filter((r) => r.promesa_fecha && r.promesa_fecha < hoy).length;
    resumen.innerHTML = `<dl class="resumen">
      <div><dt>Cartera por cobrar</dt><dd class="${cartera > 0 ? 'deuda' : ''}">${money(cartera)}</dd></div>
      <div><dt>Clientes con saldo</dt><dd>${num(conSaldo.length)}</dd></div>
      <div><dt>Cobrado hoy</dt><dd>${money(cobrado)}</dd></div>
      <div><dt>Promesas vencidas</dt><dd>${num(vencidas)}</dd></div>
    </dl>`;
  }

  function pintar() {
    pintarResumen();
    if (st.tab === 'ruta') pintarRuta(); else pintarTodos();
  }

  function filtrar(lista) {
    const hoy = today();
    const b = st.buscar.trim().toLowerCase();
    return lista.filter((r) => {
      if (b && !`${r.nombre} ${r.direccion ?? ''} ${r.zona ?? ''} ${r.telefono ?? ''}`.toLowerCase().includes(b)) return false;
      if (st.zona && (r.zona ?? '') !== st.zona) return false;
      if (st.estado === 'vencida' && !(r.promesa_fecha && r.promesa_fecha < hoy)) return false;
      if (st.estado === 'promesa' && !r.promesa_fecha) return false;
      if (st.estado === 'sin_visita' && Number(r.visitas_hoy) > 0) return false;
      if (st.estado === 'mora' && !(Number(r.dias_deuda) > 30)) return false;
      return true;
    });
  }

  function barraFiltros(conOrden) {
    const zonas = [...new Set(st.rows.map((r) => r.zona).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
    return `<div class="filtros">
      <div class="campo grande"><label for="f-buscar">Buscar cliente</label>
        <input id="f-buscar" type="search" value="${esc(st.buscar)}" placeholder="Nombre, barrio, dirección o teléfono" autocomplete="off"></div>
      <div class="campo"><label for="f-zona">Zona</label>
        <select id="f-zona"><option value="">Todas</option>${zonas.map((z) => `<option value="${esc(z)}"${z === st.zona ? ' selected' : ''}>${esc(z)}</option>`).join('')}</select></div>
      <div class="campo"><label for="f-estado">Mostrar</label>
        <select id="f-estado">
          ${[['', 'Todos'], ['sin_visita', 'Sin visitar hoy'], ['vencida', 'Promesa vencida'], ['promesa', 'Con promesa de pago'], ['mora', 'Más de 30 días de deuda']]
            .map(([v, t]) => `<option value="${v}"${v === st.estado ? ' selected' : ''}>${t}</option>`).join('')}
        </select></div>
      ${conOrden ? `<div class="campo"><label for="f-orden">Ordenar por</label>
        <select id="f-orden">
          ${[['prioridad', 'Prioridad de cobro'], ['saldo', 'Mayor saldo'], ['antiguedad', 'Deuda más antigua'], ['nombre', 'Nombre'], ['zona', 'Zona']]
            .map(([v, t]) => `<option value="${v}"${v === st.orden ? ' selected' : ''}>${t}</option>`).join('')}
        </select></div>` : ''}
    </div>`;
  }

  function enlazarFiltros(repintar) {
    const buscar = panel.querySelector('#f-buscar');
    buscar.addEventListener('input', () => {
      st.buscar = buscar.value;
      const pos = buscar.selectionStart;
      repintar();
      const nuevo = panel.querySelector('#f-buscar');
      nuevo.focus(); nuevo.setSelectionRange(pos, pos);
    });
    panel.querySelector('#f-zona').addEventListener('change', (e) => { st.zona = e.target.value; repintar(); });
    panel.querySelector('#f-estado').addEventListener('change', (e) => { st.estado = e.target.value; repintar(); });
    panel.querySelector('#f-orden')?.addEventListener('change', (e) => { st.orden = e.target.value; repintar(); });
  }

  function pintarRuta() {
    const ruta = st.rows.filter((r) => r.en_ruta).sort((a, b) => a.orden_ruta - b.orden_ruta);
    const lista = filtrar(ruta);
    const porCobrar = ruta.reduce((a, r) => a + Number(r.saldo_total), 0);
    const visitados = ruta.filter((r) => Number(r.visitas_hoy) > 0).length;
    panel.innerHTML = `
      <div class="barra-ruta">
        <p><strong>${ruta.length}</strong> ${ruta.length === 1 ? 'cliente' : 'clientes'} en la ruta de hoy
          ${ruta.length ? ` · visitados ${visitados} de ${ruta.length} · por cobrar ${money(porCobrar)}` : ''}</p>
        <button type="button" class="btn btn-suave" data-armar>Agregar clientes a la ruta</button>
      </div>
      ${ruta.length ? barraFiltros(false) : ''}
      <div id="tarjetas" class="tarjetas"></div>`;
    const cont = panel.querySelector('#tarjetas');
    if (!ruta.length) {
      cont.outerHTML = `<div class="vacio"><h2>La ruta de hoy está vacía</h2>
        <p>Elige a quién vas a visitar hoy. Puedes agregar clientes uno por uno o toda una zona de una vez, y después ordenarlos como vayas a recorrerlos.</p>
        <button type="button" class="btn btn-primario" data-armar>Armar la ruta de hoy</button>
        ${st.rows.length ? '' : '<p>Aún no hay clientes con saldo. <a href="#/importar-cartera">Carga la cartera que ya tienes</a> o crea un cliente nuevo.</p>'}</div>`;
      return;
    }
    enlazarFiltros(pintarRuta);
    cont.innerHTML = lista.length
      ? lista.map((r) => tarjeta(r, { ruta: true, primero: r.cliente_id === ruta[0].cliente_id, ultimo: r.cliente_id === ruta[ruta.length - 1].cliente_id })).join('')
      : '<div class="vacio"><p>Ningún cliente de la ruta coincide con los filtros.</p></div>';
  }

  function pintarTodos() {
    const base = st.rows.filter((r) => Number(r.saldo_total) > 0);
    let lista = filtrar(base);
    const ord = {
      prioridad: (a, b) => prioridad(b) - prioridad(a),
      saldo: (a, b) => Number(b.saldo_total) - Number(a.saldo_total),
      antiguedad: (a, b) => (Number(b.dias_deuda) || 0) - (Number(a.dias_deuda) || 0),
      nombre: (a, b) => a.nombre.localeCompare(b.nombre, 'es'),
      zona: (a, b) => (a.zona ?? 'zzz').localeCompare(b.zona ?? 'zzz', 'es') || a.nombre.localeCompare(b.nombre, 'es'),
    }[st.orden];
    lista = [...lista].sort(ord);
    panel.innerHTML = `${base.length ? barraFiltros(true) : ''}<div id="tarjetas" class="tarjetas"></div>`;
    const cont = panel.querySelector('#tarjetas');
    if (!base.length) {
      cont.outerHTML = `<div class="vacio"><h2>No hay clientes con saldo pendiente</h2>
        <p>Si ya tienes cartera de lotes que salieron, cárgala desde un archivo de Excel o CSV. También puedes crear un cliente nuevo con su saldo.</p>
        <a class="btn btn-primario" href="#/importar-cartera">Cargar cartera</a></div>`;
      return;
    }
    enlazarFiltros(pintarTodos);
    cont.innerHTML = lista.length
      ? `<p class="conteo">${lista.length} ${lista.length === 1 ? 'cliente' : 'clientes'}</p>` + lista.map((r) => tarjeta(r, { ruta: false })).join('')
      : '<div class="vacio"><p>Ningún cliente coincide con los filtros.</p></div>';
  }

  /* ---------- Tarjeta de cliente ---------- */
  function tarjeta(r, { ruta, primero, ultimo }) {
    const est = estadoCliente(r);
    const saldo = Number(r.saldo_total);
    const tel = telLink(r.telefono);
    const wa = waLink(r.telefono, `Hola ${r.nombre.split(' ')[0]}, te escribo por el saldo pendiente de ${money(saldo)}.`);
    const mapa = mapsLink(r.direccion, r.zona);
    const dato = (k, v) => (v ? `<div><dt>${k}</dt><dd>${v}</dd></div>` : '');
    const ult = r.ultima_visita_fecha
      ? `${esc(RESULTADO[r.ultima_visita_resultado] || '')}, ${haceTxt(r.ultima_visita_fecha)}${r.ultima_visita_nota ? ` · “${esc(r.ultima_visita_nota)}”` : ''}`
      : 'Sin visitas anotadas';
    return `<article class="cliente${Number(r.visitas_hoy) > 0 ? ' visitado' : ''}" data-id="${esc(r.cliente_id)}" aria-label="${esc(r.nombre)}">
      <header class="cl-cab">
        <div>
          <h3>${esc(r.nombre)}</h3>
          <p class="cl-sub">${[r.zona, r.direccion].filter(Boolean).map(esc).join(' · ') || 'Sin dirección'}</p>
        </div>
        <div class="cl-saldo"><span>Debe</span><strong class="${saldo > 0 ? 'deuda' : ''}">${money(saldo)}</strong></div>
      </header>
      <p class="cl-estado"><span class="chip ${est.cls}">${esc(est.txt)}</span></p>
      <dl class="cl-datos">
        ${dato('Deuda', saldo > 0 ? `${r.ventas_pendientes} ${Number(r.ventas_pendientes) === 1 ? 'venta' : 'ventas'}, la más antigua del ${fdate(r.deuda_mas_antigua)} (${haceTxt(r.deuda_mas_antigua)})` : '')}
        ${dato('Último pago', r.ultimo_pago_fecha ? `${money(r.ultimo_pago_monto)}, ${haceTxt(r.ultimo_pago_fecha)}` : 'Aún no ha pagado')}
        ${dato('Última visita', ult)}
        ${dato('Teléfono', r.telefono ? esc(r.telefono) : 'Sin teléfono')}
      </dl>
      <div class="cl-acciones">
        ${saldo > 0 ? '<button type="button" class="btn btn-primario" data-act="cobrar">Cobrar</button>' : ''}
        <button type="button" class="btn btn-suave" data-act="visita">Anotar visita</button>
        ${tel ? `<a class="btn btn-suave" href="${tel}">Llamar</a>` : ''}
        ${wa ? `<a class="btn btn-suave" href="${esc(wa)}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
        ${mapa ? `<a class="btn btn-suave" href="${esc(mapa)}" target="_blank" rel="noopener">Mapa</a>` : ''}
        <button type="button" class="btn btn-suave" data-act="detalle">Detalle</button>
      </div>
      ${ruta ? `<div class="cl-ruta">
        <span>Parada ${r.orden_ruta}</span>
        <button type="button" class="btn-texto" data-act="subir" ${primero ? 'disabled' : ''} aria-label="Subir a ${esc(r.nombre)} en la ruta">Subir</button>
        <button type="button" class="btn-texto" data-act="bajar" ${ultimo ? 'disabled' : ''} aria-label="Bajar a ${esc(r.nombre)} en la ruta">Bajar</button>
        <button type="button" class="btn-texto" data-act="quitar" aria-label="Quitar a ${esc(r.nombre)} de la ruta">Quitar de la ruta</button>
      </div>` : `<div class="cl-ruta">${r.en_ruta
        ? '<span>Está en la ruta de hoy</span>'
        : '<button type="button" class="btn-texto" data-act="agregar">Agregar a la ruta de hoy</button>'}</div>`}
    </article>`;
  }

  async function manejarAccion(e) {
    if (e.target.closest('[data-armar]')) { abrirArmarRuta(); return; }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = btn.closest('article')?.dataset.id;
    const r = st.rows.find((x) => x.cliente_id === id);
    if (!r) return;
    const act = btn.dataset.act;
    if (act === 'cobrar') abrirCobro(r);
    else if (act === 'visita') abrirVisita(r);
    else if (act === 'detalle') abrirDetalle(r);
    else if (act === 'agregar') {
      await ejecutar(() => q(db.rpc('agregar_a_ruta', { p_fecha: today(), p_clientes: [id] })), 'Agregado a la ruta de hoy');
    } else if (act === 'quitar') {
      await ejecutar(() => q(db.from('cobro_ruta_dia').delete().eq('fecha', today()).eq('cliente_id', id)), 'Quitado de la ruta');
    } else if (act === 'subir' || act === 'bajar') {
      const orden = st.rows.filter((x) => x.en_ruta).sort((a, b) => a.orden_ruta - b.orden_ruta).map((x) => x.cliente_id);
      const i = orden.indexOf(id);
      const j = act === 'subir' ? i - 1 : i + 1;
      if (j < 0 || j >= orden.length) return;
      [orden[i], orden[j]] = [orden[j], orden[i]];
      await ejecutar(() => q(db.rpc('guardar_orden_ruta', { p_fecha: today(), p_clientes: orden })));
      // mantener la tarjeta a la vista tras moverla
      panel.querySelector(`article[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' });
    }
  }

  async function ejecutar(fn, aviso) {
    try { await fn(); if (aviso) toast(aviso); await cargar(true); }
    catch (ex) { toast(errMsg(ex), 'mal'); }
  }

  /* ---------- Cobrar ---------- */
  function abrirCobro(r, { alTerminar } = {}) {
    const saldo = Number(r.saldo_total);
    const m = modal({
      title: `Cobrar a ${r.nombre}`,
      html: `<form id="f-cobro" novalidate>
        <p class="total-linea"><span>Saldo actual</span><strong class="deuda">${money(saldo)}</strong></p>
        <div class="rejilla">
          <div class="campo"><label for="k-monto">Valor cobrado</label>
            <input id="k-monto" type="text" inputmode="numeric" autocomplete="off" placeholder="$ 0" required>
            <button type="button" class="btn btn-suave btn-chico" id="k-todo">Pagó todo el saldo</button></div>
          <div class="campo"><label for="k-fecha">Fecha del cobro</label>
            <input id="k-fecha" type="date" value="${today()}" max="${today()}" required></div>
        </div>
        ${radiosMetodo}
        <p class="total-linea" id="k-queda" hidden><span>Saldo que queda</span><strong id="k-queda-v"></strong></p>
        <div id="k-prom" hidden>
          <div class="campo"><label for="k-promesa">¿Para cuándo promete pagar el resto? (opcional)</label>
            <input id="k-promesa" type="date" min="${today()}"></div>
        </div>
        <div class="campo"><label for="k-nota">Nota (opcional)</label><input id="k-nota" type="text" autocomplete="off"></div>
        <p class="ayuda">El cobro se aplica primero a la deuda más antigua del cliente.</p>
        <p class="error" id="k-error" role="alert" hidden></p>
        <div class="acciones-form">
          <button type="button" class="btn btn-suave" data-cerrar>Cancelar</button>
          <button type="submit" class="btn btn-primario">Guardar cobro</button>
        </div>
      </form>`,
    });
    const f = m.el.querySelector('#f-cobro');
    const $ = (id) => f.querySelector(id);
    const monto = $('#k-monto'); const err = $('#k-error');
    bindMoney(monto);
    const actualizar = () => {
      const v = readMoney(monto);
      $('#k-queda').hidden = v <= 0 || v > saldo;
      $('#k-queda-v').textContent = money(saldo - v);
      $('#k-prom').hidden = v <= 0 || v >= saldo;
    };
    monto.addEventListener('input', actualizar);
    $('#k-todo').addEventListener('click', () => { setMoney(monto, saldo); actualizar(); monto.focus(); });

    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.hidden = true;
      const v = readMoney(monto);
      if (v <= 0) return showError(err, 'Escribe el valor cobrado.');
      if (v > saldo) return showError(err, `El cobro no puede ser mayor que la deuda (${money(saldo)}).`);
      if (!$('#k-fecha').value) return showError(err, 'Elige la fecha del cobro.');
      await withBusy(f.querySelector('[type=submit]'), async () => {
        try {
          await q(db.rpc('registrar_cobro', {
            p_cliente_id: r.cliente_id,
            p_monto: v,
            p_metodo: f.querySelector('input[name=metodo]:checked').value,
            p_fecha: $('#k-fecha').value,
            p_nota: $('#k-nota').value.trim() || null,
            p_promesa_fecha: v < saldo && $('#k-promesa').value ? $('#k-promesa').value : null,
          }));
          m.close();
          toast(v >= saldo ? `${r.nombre} quedó al día` : `Cobro de ${money(v)} guardado`);
          await cargar(true);
          alTerminar?.();
        } catch (ex) { showError(err, errMsg(ex)); }
      });
    });
  }

  /* ---------- Anotar visita ---------- */
  function abrirVisita(r, { alTerminar } = {}) {
    const m = modal({
      title: `Visita a ${r.nombre}`,
      html: `<form id="f-visita" novalidate>
        <fieldset class="segmento campo"><legend>¿Qué pasó?</legend>
          <div class="opciones">
            <label><input type="radio" name="res" value="promesa" checked><span>Prometió pagar</span></label>
            <label><input type="radio" name="res" value="no_estaba"><span>No estaba</span></label>
            <label><input type="radio" name="res" value="no_pago"><span>No pagó</span></label>
            <label><input type="radio" name="res" value="otro"><span>Otro</span></label>
          </div>
        </fieldset>
        <div class="campo" id="v-prom"><label for="v-fecha-prom">¿Qué día promete pagar?</label>
          <input id="v-fecha-prom" type="date" min="${today()}" required></div>
        <div class="campo"><label for="v-nota">Nota (opcional)</label>
          <textarea id="v-nota" rows="2" placeholder="Por ejemplo: dice que paga cuando venda los cerdos"></textarea></div>
        <p class="ayuda">Si recibiste plata, usa el botón Cobrar: ahí queda el pago y la visita.</p>
        <p class="error" id="v-error" role="alert" hidden></p>
        <div class="acciones-form">
          <button type="button" class="btn btn-suave" data-cerrar>Cancelar</button>
          <button type="submit" class="btn btn-primario">Guardar visita</button>
        </div>
      </form>`,
    });
    const f = m.el.querySelector('#f-visita');
    const err = f.querySelector('#v-error');
    const res = () => f.querySelector('input[name=res]:checked').value;
    f.addEventListener('change', () => { f.querySelector('#v-prom').hidden = res() !== 'promesa'; });
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.hidden = true;
      const prom = f.querySelector('#v-fecha-prom').value;
      if (res() === 'promesa' && !prom) return showError(err, 'Elige el día en que promete pagar.');
      await withBusy(f.querySelector('[type=submit]'), async () => {
        try {
          await q(db.rpc('registrar_visita', {
            p_cliente_id: r.cliente_id,
            p_resultado: res(),
            p_fecha: today(),
            p_nota: f.querySelector('#v-nota').value.trim() || null,
            p_promesa_fecha: res() === 'promesa' ? prom : null,
          }));
          m.close();
          toast('Visita anotada');
          await cargar(true);
          alTerminar?.();
        } catch (ex) { showError(err, errMsg(ex)); }
      });
    });
  }

  /* ---------- Armar la ruta del día ---------- */
  function abrirArmarRuta() {
    const disponibles = st.rows.filter((r) => !r.en_ruta && Number(r.saldo_total) > 0)
      .sort((a, b) => prioridad(b) - prioridad(a));
    if (!disponibles.length) { toast('Todos los clientes con saldo ya están en la ruta.'); return; }
    const zonas = [...new Set(disponibles.map((r) => r.zona).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
    const sel = new Set();
    const vf = { b: '', z: '' };
    const m = modal({
      title: 'Agregar clientes a la ruta de hoy',
      wide: true,
      html: `<div class="filtros">
          <div class="campo grande"><label for="a-buscar">Buscar</label><input id="a-buscar" type="search" autocomplete="off" placeholder="Nombre, barrio o dirección"></div>
          <div class="campo"><label for="a-zona">Zona</label>
            <select id="a-zona"><option value="">Todas</option>${zonas.map((z) => `<option value="${esc(z)}">${esc(z)}</option>`).join('')}</select></div>
        </div>
        <div class="barra-ruta"><p id="a-cuenta"></p>
          <div><button type="button" class="btn btn-suave btn-chico" id="a-todos">Marcar los que se ven</button>
          <button type="button" class="btn btn-suave btn-chico" id="a-ninguno">Quitar marcas</button></div></div>
        <ul class="elegir" id="a-lista"></ul>
        <p class="error" id="a-error" role="alert" hidden></p>
        <div class="acciones-form">
          <button type="button" class="btn btn-suave" data-cerrar>Cancelar</button>
          <button type="button" class="btn btn-primario" id="a-ok">Agregar a la ruta</button>
        </div>`,
    });
    const $ = (id) => m.el.querySelector(id);
    const visibles = () => disponibles.filter((r) =>
      (!vf.z || r.zona === vf.z)
      && (!vf.b || `${r.nombre} ${r.direccion ?? ''} ${r.zona ?? ''}`.toLowerCase().includes(vf.b)));
    function pintarLista() {
      const v = visibles();
      $('#a-lista').innerHTML = v.length ? v.map((r) => `<li><label>
          <input type="checkbox" value="${esc(r.cliente_id)}"${sel.has(r.cliente_id) ? ' checked' : ''}>
          <span class="el-nombre">${esc(r.nombre)}<small>${[r.zona, r.direccion].filter(Boolean).map(esc).join(' · ') || 'Sin dirección'}</small></span>
          <span class="el-saldo">${money(r.saldo_total)}</span></label></li>`).join('')
        : '<li class="vacio-li">Ningún cliente coincide.</li>';
      $('#a-cuenta').innerHTML = `<strong>${sel.size}</strong> ${sel.size === 1 ? 'marcado' : 'marcados'} de ${disponibles.length} disponibles`;
      $('#a-ok').textContent = sel.size ? `Agregar ${sel.size} a la ruta` : 'Agregar a la ruta';
    }
    $('#a-buscar').addEventListener('input', (e) => { vf.b = e.target.value.trim().toLowerCase(); pintarLista(); });
    $('#a-zona').addEventListener('change', (e) => { vf.z = e.target.value; pintarLista(); });
    $('#a-lista').addEventListener('change', (e) => {
      if (e.target.checked) sel.add(e.target.value); else sel.delete(e.target.value);
      $('#a-cuenta').innerHTML = `<strong>${sel.size}</strong> ${sel.size === 1 ? 'marcado' : 'marcados'} de ${disponibles.length} disponibles`;
      $('#a-ok').textContent = sel.size ? `Agregar ${sel.size} a la ruta` : 'Agregar a la ruta';
    });
    $('#a-todos').addEventListener('click', () => { visibles().forEach((r) => sel.add(r.cliente_id)); pintarLista(); });
    $('#a-ninguno').addEventListener('click', () => { sel.clear(); pintarLista(); });
    $('#a-ok').addEventListener('click', async () => {
      if (!sel.size) return showError($('#a-error'), 'Marca al menos un cliente.');
      await withBusy($('#a-ok'), async () => {
        try {
          // se agregan en el orden de prioridad que se ve en la lista
          const ids = disponibles.filter((r) => sel.has(r.cliente_id)).map((r) => r.cliente_id);
          const n = await q(db.rpc('agregar_a_ruta', { p_fecha: today(), p_clientes: ids }));
          m.close();
          toast(`${n} ${Number(n) === 1 ? 'cliente agregado' : 'clientes agregados'} a la ruta`);
          st.tab = 'ruta';
          root.querySelector('#tab-ruta').setAttribute('aria-selected', 'true');
          root.querySelector('#tab-todos').setAttribute('aria-selected', 'false');
          await cargar(true);
        } catch (ex) { showError($('#a-error'), errMsg(ex)); }
      });
    });
    pintarLista();
  }

  /* ---------- Cliente nuevo ---------- */
  function abrirNuevoCliente() {
    const m = modal({
      title: 'Nuevo cliente',
      html: `<form id="f-cli" novalidate>
        <div class="rejilla">
          <div class="campo"><label for="n-nombre">Nombre</label><input id="n-nombre" type="text" autocomplete="off" required></div>
          <div class="campo"><label for="n-tel">Teléfono</label><input id="n-tel" type="tel" inputmode="tel" autocomplete="off"></div>
          <div class="campo"><label for="n-dir">Dirección</label><input id="n-dir" type="text" autocomplete="off"></div>
          <div class="campo"><label for="n-zona">Zona o barrio</label><input id="n-zona" type="text" autocomplete="off"></div>
        </div>
        <div class="campo"><label for="n-notas">Notas</label><textarea id="n-notas" rows="2"></textarea></div>
        <fieldset class="caja"><legend>¿Ya te debe de un lote que salió? (opcional)</legend>
          <div class="rejilla">
            <div class="campo"><label for="n-saldo">Saldo que debe</label><input id="n-saldo" type="text" inputmode="numeric" autocomplete="off" placeholder="$ 0"></div>
            <div class="campo"><label for="n-fecha">¿Desde cuándo?</label><input id="n-fecha" type="date" value="${today()}" max="${today()}"></div>
            <div class="campo"><label for="n-lote">Lote del que viene</label>
              <select id="n-lote"><option value="">No sé / varios</option>${lotes.map((l) => `<option value="${l.id}">${esc(l.nombre)}</option>`).join('')}</select></div>
          </div>
        </fieldset>
        <p class="error" id="n-error" role="alert" hidden></p>
        <div class="acciones-form">
          <button type="button" class="btn btn-suave" data-cerrar>Cancelar</button>
          <button type="submit" class="btn btn-primario">Guardar cliente</button>
        </div>
      </form>`,
    });
    const f = m.el.querySelector('#f-cli');
    const $ = (id) => f.querySelector(id);
    const err = $('#n-error');
    bindMoney($('#n-saldo'));
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.hidden = true;
      if (!$('#n-nombre').value.trim()) return showError(err, 'Escribe el nombre del cliente.');
      const saldo = readMoney($('#n-saldo'));
      await withBusy(f.querySelector('[type=submit]'), async () => {
        try {
          await q(db.rpc('crear_cliente', {
            p_nombre: $('#n-nombre').value,
            p_telefono: $('#n-tel').value || null,
            p_direccion: $('#n-dir').value || null,
            p_zona: $('#n-zona').value || null,
            p_notas: $('#n-notas').value || null,
            p_saldo: saldo,
            p_fecha: saldo > 0 ? $('#n-fecha').value : null,
            p_lote: saldo > 0 && $('#n-lote').value ? Number($('#n-lote').value) : null,
          }));
          m.close();
          toast('Cliente guardado');
          await cargar(true);
        } catch (ex) { showError(err, errMsg(ex)); }
      });
    });
  }

  /* ---------- Detalle del cliente ---------- */
  async function abrirDetalle(r0) {
    const id = r0.cliente_id;
    const m = modal({ title: r0.nombre, html: loading(), wide: true });

    async function pintarDetalle() {
      const [cli, ventas, pagos, visitas] = await Promise.all([
        q(db.from('clientes').select('*').eq('id', id).single()),
        q(db.from('v_cartera_ventas').select('*').eq('cliente_id', id).order('fecha', { ascending: false })),
        q(db.from('v_pagos_cliente').select('*').eq('cliente_id', id).order('fecha', { ascending: false }).order('created_at', { ascending: false })),
        q(db.from('cobro_visitas').select('*').eq('cliente_id', id).order('fecha', { ascending: false }).order('created_at', { ascending: false }).limit(30)),
      ]);
      const r = st.rows.find((x) => x.cliente_id === id) || { ...r0, saldo_total: ventas.reduce((a, v) => a + Math.max(0, Number(v.saldo)), 0) };
      const saldo = ventas.reduce((a, v) => a + Math.max(0, Number(v.saldo)), 0);
      const tot = ventas.reduce((a, v) => a + Number(v.total), 0);
      const pag = ventas.reduce((a, v) => a + Number(v.pagado), 0);
      const tel = telLink(cli.telefono); const wa = waLink(cli.telefono); const mapa = mapsLink(cli.direccion, cli.zona);
      const ESTV = { pagada: ['Pagada', 'chip-verde'], parcial: ['Abonada', 'chip-ocre'], pendiente: ['Sin pago', 'chip-rojo'] };
      m.setBody(`
        <div class="cl-acciones cl-acciones-det">
          ${saldo > 0 ? '<button type="button" class="btn btn-primario" data-d="cobrar">Cobrar</button>' : ''}
          <button type="button" class="btn btn-suave" data-d="visita">Anotar visita</button>
          ${tel ? `<a class="btn btn-suave" href="${tel}">Llamar</a>` : ''}
          ${wa ? `<a class="btn btn-suave" href="${esc(wa)}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
          ${mapa ? `<a class="btn btn-suave" href="${esc(mapa)}" target="_blank" rel="noopener">Mapa</a>` : ''}
          <button type="button" class="btn btn-suave" data-d="editar">Editar datos</button>
        </div>
        <dl class="resumen">
          <div><dt>Debe</dt><dd class="${saldo > 0 ? 'deuda' : ''}">${money(saldo)}</dd></div>
          <div><dt>Total vendido</dt><dd>${money(tot)}</dd></div>
          <div><dt>Total pagado</dt><dd>${money(pag)}</dd></div>
        </dl>
        <dl class="detalle">
          <div><dt>Teléfono</dt><dd>${cli.telefono ? esc(cli.telefono) : 'Sin teléfono'}</dd></div>
          <div><dt>Zona</dt><dd>${cli.zona ? esc(cli.zona) : 'Sin zona'}</dd></div>
          <div><dt>Dirección</dt><dd>${cli.direccion ? esc(cli.direccion) : 'Sin dirección'}</dd></div>
          ${cli.documento ? `<div><dt>Documento</dt><dd>${esc(cli.documento)}</dd></div>` : ''}
          ${cli.notas ? `<div style="grid-column:1/-1"><dt>Notas</dt><dd>${esc(cli.notas)}</dd></div>` : ''}
        </dl>

        <h3>Ventas y deudas</h3>
        ${ventas.length ? `<div class="tabla-wrap"><table class="tabla">
          <thead><tr><th>Fecha</th><th>De dónde</th><th class="der">Total</th><th class="der">Pagado</th><th class="der">Saldo</th><th>Estado</th></tr></thead>
          <tbody>${ventas.map((v) => {
            const e = ESTV[v.estado] || [esc(v.estado), 'chip-ocre'];
            const origen = v.origen === 'migracion' ? `Cartera anterior${v.lotes ? ` (${esc(v.lotes)})` : ''}` : (v.lotes ? esc(v.lotes) : 'Venta');
            return `<tr>
              <td data-label="Fecha">${fdate(v.fecha)}</td>
              <td data-label="De dónde" class="ancho">${origen}${v.observacion && v.observacion !== 'Cartera migrada' ? `<span class="obs">${esc(v.observacion)}</span>` : ''}</td>
              <td data-label="Total" class="der">${money(v.total)}</td>
              <td data-label="Pagado" class="der">${money(v.pagado)}</td>
              <td data-label="Saldo" class="der ${Number(v.saldo) > 0 ? 'deuda' : ''}">${money(v.saldo)}</td>
              <td data-label="Estado"><span class="chip ${e[1]}">${e[0]}</span></td></tr>`;
          }).join('')}</tbody></table></div>` : '<p>Este cliente todavía no tiene ventas.</p>'}

        <h3>Pagos recibidos</h3>
        ${pagos.length ? `<div class="tabla-wrap"><table class="tabla">
          <thead><tr><th>Fecha</th><th>Método</th><th class="der">Valor</th><th>Aplicado a</th></tr></thead>
          <tbody>${pagos.map((p) => `<tr>
            <td data-label="Fecha">${fdate(p.fecha)}</td>
            <td data-label="Método">${esc(METODO[p.metodo] || p.metodo)}</td>
            <td data-label="Valor" class="der">${money(p.monto)}</td>
            <td data-label="Aplicado a" class="ancho">Venta del ${fdate(p.venta_fecha)}${p.observacion ? `<span class="obs">${esc(p.observacion)}</span>` : ''}</td></tr>`).join('')}</tbody>
        </table></div>` : '<p>Todavía no hay pagos registrados.</p>'}

        <h3>Visitas de cobro</h3>
        ${visitas.length ? `<ul class="historial">${visitas.map((v) => `<li>
          <strong>${esc(RESULTADO[v.resultado] || v.resultado)}</strong>${Number(v.monto) > 0 ? ` · ${money(v.monto)}` : ''}
          <span class="fecha">${fdate(v.fecha)}</span>
          ${v.promesa_fecha ? `<span class="obs">Promete pagar el ${fdate(v.promesa_fecha)}</span>` : ''}
          ${v.nota ? `<span class="obs">${esc(v.nota)}</span>` : ''}</li>`).join('')}</ul>` : '<p>Todavía no hay visitas anotadas.</p>'}
      `);
      m.el.dataset.saldo = saldo;
      m.el.querySelector('[data-d=cobrar]')?.addEventListener('click', () => {
        abrirCobro({ ...r, cliente_id: id, nombre: cli.nombre, saldo_total: saldo }, { alTerminar: () => pintarDetalle().catch(() => {}) });
      });
      m.el.querySelector('[data-d=visita]').addEventListener('click', () => {
        abrirVisita({ ...r, cliente_id: id, nombre: cli.nombre }, { alTerminar: () => pintarDetalle().catch(() => {}) });
      });
      m.el.querySelector('[data-d=editar]').addEventListener('click', () => editarCliente(cli, () => pintarDetalle().catch(() => {})));
    }

    try { await pintarDetalle(); } catch (e) { m.setBody(errorHtml(e)); }
  }

  function editarCliente(cli, alTerminar) {
    const m = modal({
      title: 'Editar datos del cliente',
      html: `<form id="f-edit" novalidate>
        <div class="rejilla">
          <div class="campo"><label for="e-nombre">Nombre</label><input id="e-nombre" type="text" value="${esc(cli.nombre)}" required></div>
          <div class="campo"><label for="e-tel">Teléfono</label><input id="e-tel" type="tel" inputmode="tel" value="${esc(cli.telefono)}"></div>
          <div class="campo"><label for="e-dir">Dirección</label><input id="e-dir" type="text" value="${esc(cli.direccion)}"></div>
          <div class="campo"><label for="e-zona">Zona o barrio</label><input id="e-zona" type="text" value="${esc(cli.zona)}"></div>
        </div>
        <div class="campo"><label for="e-notas">Notas</label><textarea id="e-notas" rows="2">${esc(cli.notas)}</textarea></div>
        <p class="error" id="e-error" role="alert" hidden></p>
        <div class="acciones-form">
          <button type="button" class="btn btn-suave" data-cerrar>Cancelar</button>
          <button type="submit" class="btn btn-primario">Guardar cambios</button>
        </div>
      </form>`,
    });
    const f = m.el.querySelector('#f-edit');
    const $ = (id) => f.querySelector(id);
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('#e-error'); err.hidden = true;
      const nombre = $('#e-nombre').value.trim().replace(/\s+/g, ' ');
      if (!nombre) return showError(err, 'Escribe el nombre del cliente.');
      await withBusy(f.querySelector('[type=submit]'), async () => {
        try {
          await q(db.from('clientes').update({
            nombre,
            telefono: $('#e-tel').value.trim() || null,
            direccion: $('#e-dir').value.trim() || null,
            zona: $('#e-zona').value.trim() || null,
            notas: $('#e-notas').value.trim() || null,
          }).eq('id', cli.id));
          m.close();
          toast('Datos guardados');
          alTerminar();
          await cargar(true);
        } catch (ex) { showError(err, errMsg(ex)); }
      });
    });
  }

  await cargar();
}
