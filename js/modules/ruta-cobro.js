/* Ruta de cobro automática: cada día sale sola la lista de quién debe pagar (atrasados, los de hoy
   y los que no tienen fecha). Tarjeta por cliente, cobros, visitas, promesas y deudas nuevas. */
import {
  db, q, money, num, fdate, today, addDays, haceTxt, esc, errMsg, toast, modal, errorHtml, loading,
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

/** Botones para elegir rápido la fecha de cobro (hoy, en 8, 15 o 30 días) */
const atajosFecha = (idCampo) => `<div class="atajos" data-atajos="${idCampo}" role="group" aria-label="Fechas rápidas">
  ${[['Hoy', 0], ['En 8 días', 8], ['En 15 días', 15], ['En 30 días', 30]]
    .map(([t, d]) => `<button type="button" class="btn btn-suave btn-chico" data-dias="${d}">${t}</button>`).join('')}</div>`;
function enlazarAtajos(el) {
  el.querySelectorAll('[data-atajos]').forEach((g) => g.addEventListener('click', (e) => {
    const b = e.target.closest('[data-dias]');
    if (!b) return;
    const campo = el.querySelector(`#${g.dataset.atajos}`);
    campo.value = addDays(today(), Number(b.dataset.dias));
    campo.dispatchEvent(new Event('input', { bubbles: true }));
  }));
}

const estaPendiente = (r) => Number(r.saldo_total) > 0 && ['atrasado', 'hoy', 'sin_fecha'].includes(r.estado_cobro);
const huboActividad = (r) => Number(r.visitas_hoy) > 0 || Number(r.cobrado_hoy) > 0;

/** Etiqueta única y más importante de la tarjeta */
function estadoCliente(r) {
  const hoy = today();
  if (Number(r.cobrado_hoy) > 0) return { txt: `Cobró hoy ${money(r.cobrado_hoy)}`, cls: 'chip-verde' };
  if (Number(r.saldo_total) <= 0) return { txt: 'Al día', cls: 'chip-verde' };
  if (Number(r.visitas_hoy) > 0 && r.ultima_visita_resultado === 'no_estaba') return { txt: 'No estaba hoy', cls: 'chip-ocre' };
  if (r.promesa_fecha && r.estado_cobro === 'proximo') return { txt: `Prometió pagar el ${fdate(r.promesa_fecha)}`, cls: 'chip-ocre' };
  if (r.estado_cobro === 'atrasado') {
    const n = Number(r.dias_atraso);
    return { txt: `Atrasado ${n} ${n === 1 ? 'día' : 'días'}`, cls: 'chip-rojo' };
  }
  if (r.estado_cobro === 'hoy') return { txt: r.promesa_fecha === hoy ? 'Prometió pagar hoy' : 'Toca cobrar hoy', cls: 'chip-ocre' };
  if (r.estado_cobro === 'sin_fecha') return { txt: 'Sin fecha de cobro', cls: 'chip-ocre' };
  return { txt: `Cobro el ${fdate(r.proxima_cobro)}`, cls: 'chip-verde' };
}

/** Orden de la ruta: primero los más atrasados, luego los de hoy, los que no tienen fecha y los agregados a mano */
function prioridad(r) {
  const base = { atrasado: 1e6 + (Number(r.dias_atraso) || 0) * 1000, hoy: 5e5, sin_fecha: 3e5, proximo: r.en_ruta ? 1e5 : 0 }[r.estado_cobro] || 0;
  return base + Math.min(Number(r.saldo_total) / 1e4, 999);
}

export async function render({ root }) {
  const lotes = await getLotes();
  const st = { tab: 'hoy', rows: [], buscar: '', zona: '', orden: 'prioridad' };
  let carga = 0;

  root.innerHTML = `
    <header class="page-head">
      <div>
        <h1 tabindex="-1">Ruta de cobro</h1>
        <p class="sub">Aquí sale solo a quién debes cobrarle hoy. Anota los clientes que te deben y la fecha acordada; el resto lo hace la ruta.</p>
      </div>
      <div class="acciones-cab">
        <a class="btn btn-suave" href="#/importar-cartera">Cargar cartera</a>
        <button type="button" class="btn btn-primario" id="btn-cliente">Nuevo cliente</button>
      </div>
    </header>
    <div id="resumen"></div>
    <div class="tabs" role="tablist" aria-label="Secciones">
      <button type="button" role="tab" id="tab-hoy" aria-selected="true" aria-controls="panel">Para cobrar hoy</button>
      <button type="button" role="tab" id="tab-proximos" aria-selected="false" aria-controls="panel">Próximos</button>
      <button type="button" role="tab" id="tab-todos" aria-selected="false" aria-controls="panel">Todos con saldo</button>
    </div>
    <div id="panel" role="tabpanel"></div>`;

  const panel = root.querySelector('#panel');
  const resumen = root.querySelector('#resumen');

  function irATab(tab) {
    st.tab = tab;
    root.querySelectorAll('[role=tab]').forEach((x) => x.setAttribute('aria-selected', String(x.id === `tab-${tab}`)));
    pintar();
  }
  root.querySelectorAll('[role=tab]').forEach((t) => t.addEventListener('click', () => irATab(t.id.replace('tab-', ''))));
  root.querySelector('#btn-cliente').addEventListener('click', () => abrirNuevoCliente());

  /* La lista se actualiza sola al volver a la app (por ejemplo, al día siguiente o desde otro dispositivo) */
  const alVolver = () => {
    if (!root.isConnected) { document.removeEventListener('visibilitychange', alVolver); return; }
    if (document.visibilityState === 'visible' && !document.querySelector('.modal-fondo')) cargar(true);
  };
  document.addEventListener('visibilitychange', alVolver);

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
      if (mi === carga && !silencioso) panel.innerHTML = errorHtml(e);
    }
  }
  panel.addEventListener('click', (e) => {
    if (e.target.closest('[data-reintentar]')) { cargar(); return; }
    if (e.target.closest('[data-nuevo]')) { abrirNuevoCliente(); return; }
    manejarAccion(e);
  });

  /* ---------- Listas ---------- */
  const ordenar = (lista) => {
    const f = {
      prioridad: (a, b) => prioridad(b) - prioridad(a),
      saldo: (a, b) => Number(b.saldo_total) - Number(a.saldo_total),
      zona: (a, b) => (a.zona ?? 'zzz').localeCompare(b.zona ?? 'zzz', 'es') || prioridad(b) - prioridad(a),
      nombre: (a, b) => a.nombre.localeCompare(b.nombre, 'es'),
      fecha: (a, b) => String(a.proxima_cobro ?? '9999').localeCompare(String(b.proxima_cobro ?? '9999')),
    }[st.orden];
    return [...lista].sort(f);
  };
  function filtrar(lista) {
    const b = st.buscar.trim().toLowerCase();
    return lista.filter((r) => {
      if (b && !`${r.nombre} ${r.direccion ?? ''} ${r.zona ?? ''} ${r.telefono ?? ''}`.toLowerCase().includes(b)) return false;
      if (st.zona && (r.zona ?? '') !== st.zona) return false;
      return true;
    });
  }
  const grupos = () => {
    const conSaldo = st.rows.filter((r) => Number(r.saldo_total) > 0);
    const pendientes = conSaldo.filter((r) => !huboActividad(r) && (estaPendiente(r) || r.en_ruta));
    const hechos = st.rows.filter(huboActividad);
    const proximos = conSaldo.filter((r) => r.estado_cobro === 'proximo' && !r.en_ruta);
    return { conSaldo, pendientes, hechos, proximos };
  };

  function pintarResumen() {
    const { conSaldo, pendientes } = grupos();
    const atrasados = conSaldo.filter((r) => r.estado_cobro === 'atrasado');
    const cobrado = st.rows.reduce((a, r) => a + Number(r.cobrado_hoy), 0);
    const visitados = st.rows.filter((r) => Number(r.visitas_hoy) > 0).length;
    const porCobrar = pendientes.reduce((a, r) => a + Number(r.saldo_total), 0);
    resumen.innerHTML = `<dl class="resumen">
      <div><dt>Por cobrar hoy</dt><dd class="${porCobrar > 0 ? 'deuda' : ''}">${money(porCobrar)}</dd></div>
      <div><dt>Clientes atrasados</dt><dd class="${atrasados.length ? 'deuda' : ''}">${num(atrasados.length)}</dd></div>
      <div><dt>Cobrado hoy</dt><dd>${money(cobrado)}</dd></div>
      <div><dt>Cartera total</dt><dd>${money(conSaldo.reduce((a, r) => a + Number(r.saldo_total), 0))}</dd></div>
    </dl>`;
    root.querySelector('#tab-hoy').textContent = `Para cobrar hoy (${pendientes.length})`;
    root.querySelector('#tab-proximos').textContent = `Próximos (${grupos().proximos.length})`;
  }

  function barraFiltros() {
    const zonas = [...new Set(st.rows.map((r) => r.zona).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
    return `<div class="filtros">
      <div class="campo grande"><label for="f-buscar">Buscar cliente</label>
        <input id="f-buscar" type="search" value="${esc(st.buscar)}" placeholder="Nombre, barrio, dirección o teléfono" autocomplete="off"></div>
      <div class="campo"><label for="f-zona">Zona</label>
        <select id="f-zona"><option value="">Todas</option>${zonas.map((z) => `<option value="${esc(z)}"${z === st.zona ? ' selected' : ''}>${esc(z)}</option>`).join('')}</select></div>
      <div class="campo"><label for="f-orden">Ordenar por</label>
        <select id="f-orden">
          ${[['prioridad', 'Quién urge más'], ['zona', 'Zona'], ['saldo', 'Mayor saldo'], ['fecha', 'Fecha de cobro'], ['nombre', 'Nombre']]
            .map(([v, t]) => `<option value="${v}"${v === st.orden ? ' selected' : ''}>${t}</option>`).join('')}
        </select></div>
    </div>`;
  }
  function enlazarFiltros() {
    const buscar = panel.querySelector('#f-buscar');
    buscar.addEventListener('input', () => {
      st.buscar = buscar.value;
      const pos = buscar.selectionStart;
      pintarListas();
      const nuevo = panel.querySelector('#f-buscar');
      nuevo.focus(); nuevo.setSelectionRange(pos, pos);
    });
    panel.querySelector('#f-zona').addEventListener('change', (e) => { st.zona = e.target.value; pintarListas(); });
    panel.querySelector('#f-orden').addEventListener('change', (e) => { st.orden = e.target.value; pintarListas(); });
  }

  function pintar() {
    pintarResumen();
    const { conSaldo } = grupos();
    if (!st.rows.length || (!conSaldo.length && !grupos().hechos.length)) {
      panel.innerHTML = `<div class="vacio"><h2>Todavía no hay clientes con deuda</h2>
        <p>Crea un cliente, escribe cuánto te debe y la fecha en que acordaron el cobro. Cuando llegue esa fecha, aparece solo en la ruta de hoy; si ya pasó, sale como atrasado.</p>
        <button type="button" class="btn btn-primario" data-nuevo>Nuevo cliente</button>
        <p>¿Tienes una lista larga de deudores? <a href="#/importar-cartera">Cárgala desde Excel</a>.</p></div>`;
      return;
    }
    panel.innerHTML = `${barraFiltros()}<div id="tarjetas"></div>`;
    enlazarFiltros();
    pintarListas();
  }

  function pintarListas() {
    const g = grupos();
    const cont = panel.querySelector('#tarjetas');
    const bloque = (titulo, lista, opc) => (lista.length
      ? `${titulo ? `<h2 class="seccion">${titulo} <span class="num">${lista.length}</span></h2>` : ''}
         <div class="tarjetas">${lista.map((r) => tarjeta(r, opc)).join('')}</div>` : '');
    let html = '';
    if (st.tab === 'hoy') {
      const pend = ordenar(filtrar(g.pendientes));
      const hechos = ordenar(filtrar(g.hechos));
      html = bloque(pend.length && hechos.length ? 'Por cobrar' : '', pend, {}) + bloque(hechos.length ? 'Ya atendidos hoy' : '', hechos, {});
      if (!pend.length && !hechos.length) {
        const prox = ordenar(g.proximos).sort((a, b) => String(a.proxima_cobro).localeCompare(String(b.proxima_cobro)))[0];
        html = `<div class="vacio"><h2>${g.pendientes.length || g.hechos.length ? 'Ningún cliente coincide con los filtros' : 'No tienes cobros pendientes para hoy'}</h2>
          ${g.pendientes.length || g.hechos.length ? '' : `<p>${prox ? `El próximo cobro es el ${fdate(prox.proxima_cobro)} (${esc(prox.nombre)}).` : 'Cuando un cliente llegue a su fecha de cobro, aparece aquí solo.'}</p>`}</div>`;
      } else if (!pend.length && !st.buscar && !st.zona) {
        html = `<div class="vacio listo-hoy"><h2>Ruta del día completa</h2><p>Ya atendiste a todos los que tocaba cobrar hoy.</p></div>` + html;
      }
    } else if (st.tab === 'proximos') {
      const lista = filtrar(g.proximos).sort((a, b) => String(a.proxima_cobro).localeCompare(String(b.proxima_cobro)));
      html = lista.length ? bloque('', st.orden === 'prioridad' ? lista : ordenar(lista), {})
        : '<div class="vacio"><p>No hay cobros próximos con esos filtros.</p></div>';
    } else {
      const lista = ordenar(filtrar(g.conSaldo));
      html = lista.length ? `<p class="conteo">${lista.length} ${lista.length === 1 ? 'cliente' : 'clientes'}</p>${bloque('', lista, {})}`
        : '<div class="vacio"><p>Ningún cliente coincide con los filtros.</p></div>';
    }
    cont.innerHTML = html;
  }

  /* ---------- Tarjeta de cliente ---------- */
  function tarjeta(r) {
    const est = estadoCliente(r);
    const saldo = Number(r.saldo_total);
    const tel = telLink(r.telefono);
    const wa = waLink(r.telefono, `Hola ${r.nombre.split(' ')[0]}, te escribo por el saldo pendiente de ${money(saldo)}.`);
    const mapa = mapsLink(r.direccion, r.zona);
    const dato = (k, v) => (v ? `<div><dt>${k}</dt><dd>${v}</dd></div>` : '');
    const ult = r.ultima_visita_fecha
      ? `${esc(RESULTADO[r.ultima_visita_resultado] || '')}, ${haceTxt(r.ultima_visita_fecha)}${r.ultima_visita_nota ? ` · “${esc(r.ultima_visita_nota)}”` : ''}`
      : 'Sin visitas anotadas';
    const cobro = saldo > 0
      ? (r.proxima_cobro
        ? `${r.promesa_fecha ? 'Prometió pagar el' : 'Acordado para el'} ${fdate(r.proxima_cobro)} (${haceTxt(r.proxima_cobro)})`
        : 'Sin fecha acordada')
      : '';
    const manual = r.en_ruta && saldo > 0 && r.estado_cobro === 'proximo';
    const puedeAgregar = !r.en_ruta && saldo > 0 && r.estado_cobro === 'proximo';
    return `<article class="cliente${huboActividad(r) ? ' visitado' : ''}${r.estado_cobro === 'atrasado' && !huboActividad(r) ? ' atrasado' : ''}" data-id="${esc(r.cliente_id)}" aria-label="${esc(r.nombre)}">
      <header class="cl-cab">
        <div>
          <h3>${esc(r.nombre)}</h3>
          <p class="cl-sub">${[r.zona, r.direccion].filter(Boolean).map(esc).join(' · ') || 'Sin dirección'}</p>
        </div>
        <div class="cl-saldo"><span>Debe</span><strong class="${saldo > 0 ? 'deuda' : ''}">${money(saldo)}</strong></div>
      </header>
      <p class="cl-estado"><span class="chip ${est.cls}">${esc(est.txt)}</span></p>
      <dl class="cl-datos">
        ${dato('Cobro', cobro)}
        ${dato('Deuda', saldo > 0 ? `${r.ventas_pendientes} ${Number(r.ventas_pendientes) === 1 ? 'venta' : 'ventas'}, la más antigua del ${fdate(r.deuda_mas_antigua)}` : '')}
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
      ${manual ? '<div class="cl-ruta"><span>Agregado a la ruta de hoy</span><button type="button" class="btn-texto" data-act="quitar">Quitar</button></div>' : ''}
      ${puedeAgregar ? '<div class="cl-ruta"><button type="button" class="btn-texto" data-act="agregar">Cobrarle hoy de todos modos</button></div>' : ''}
    </article>`;
  }

  async function manejarAccion(e) {
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
      await ejecutar(() => q(db.from('cobro_ruta_dia').delete().eq('fecha', today()).eq('cliente_id', id)), 'Quitado de la ruta de hoy');
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
            <input id="k-promesa" type="date" min="${today()}">${atajosFecha('k-promesa')}</div>
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
    enlazarAtajos(f);
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
          <input id="v-fecha-prom" type="date" min="${today()}" required>${atajosFecha('v-fecha-prom')}</div>
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
    enlazarAtajos(f);
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

  /* ---------- Campos de una deuda (cliente nuevo y deuda nueva) ---------- */
  const camposDeuda = (p) => `
    <div class="rejilla">
      <div class="campo"><label for="${p}-cobro">¿Cuándo acordaron el cobro?</label>
        <input id="${p}-cobro" type="date" min="${addDays(today(), -365)}"><span class="ayuda">Con esta fecha la ruta sabe cuándo salir a cobrar y quién está atrasado.</span>
        ${atajosFecha(`${p}-cobro`)}</div>
      <div class="campo"><label for="${p}-fecha">Fecha de la deuda</label>
        <input id="${p}-fecha" type="date" value="${today()}" max="${today()}"></div>
      <div class="campo"><label for="${p}-lote">Lote del que viene</label>
        <select id="${p}-lote"><option value="">No sé / varios</option>${lotes.map((l) => `<option value="${l.id}">${esc(l.nombre)}</option>`).join('')}</select></div>
    </div>`;

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
        <fieldset class="caja"><legend>¿Te debe plata?</legend>
          <div class="campo"><label for="n-saldo">Cuánto debe</label>
            <input id="n-saldo" type="text" inputmode="numeric" autocomplete="off" placeholder="$ 0">
            <span class="ayuda">Déjalo vacío si no te debe nada.</span></div>
          <div id="n-deuda" hidden>${camposDeuda('n')}
            <div class="campo"><label for="n-obs">Detalle de la deuda (opcional)</label><input id="n-obs" type="text" autocomplete="off" placeholder="Ej.: 4 cerdos del lote 2"></div></div>
        </fieldset>
        <div class="campo"><label for="n-notas">Notas (opcional)</label><textarea id="n-notas" rows="2"></textarea></div>
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
    enlazarAtajos(f);
    $('#n-saldo').addEventListener('input', () => { $('#n-deuda').hidden = readMoney($('#n-saldo')) <= 0; });
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.hidden = true;
      if (!$('#n-nombre').value.trim()) return showError(err, 'Escribe el nombre del cliente.');
      const saldo = readMoney($('#n-saldo'));
      const fcobro = $('#n-cobro').value;
      if (saldo > 0 && !fcobro) return showError(err, 'Elige la fecha en que acordaron el cobro. Con ella la ruta sabe cuándo salir a cobrar.');
      if (saldo > 0 && !$('#n-fecha').value) return showError(err, 'Elige la fecha de la deuda.');
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
            p_observacion: saldo > 0 ? ($('#n-obs').value || null) : null,
            p_fecha_cobro: saldo > 0 ? fcobro : null,
          }));
          m.close();
          if (saldo <= 0) toast('Cliente guardado');
          else if (fcobro <= today()) { toast(`Cliente guardado. Ya aparece en la ruta de hoy`); irATab('hoy'); }
          else { toast(`Cliente guardado. Le cobras el ${fdate(fcobro)}`); }
          await cargar(true);
        } catch (ex) { showError(err, errMsg(ex)); }
      });
    });
  }

  /* ---------- Deuda nueva para un cliente que ya existe ---------- */
  function abrirDeuda(cli, alTerminar) {
    const m = modal({
      title: `Anotar deuda de ${cli.nombre}`,
      html: `<form id="f-deuda" novalidate>
        <div class="campo"><label for="d-saldo">Cuánto debe</label>
          <input id="d-saldo" type="text" inputmode="numeric" autocomplete="off" placeholder="$ 0" required></div>
        ${camposDeuda('d')}
        <div class="campo"><label for="d-obs">Detalle (opcional)</label><input id="d-obs" type="text" autocomplete="off"></div>
        <p class="error" id="d-error" role="alert" hidden></p>
        <div class="acciones-form">
          <button type="button" class="btn btn-suave" data-cerrar>Cancelar</button>
          <button type="submit" class="btn btn-primario">Guardar deuda</button>
        </div>
      </form>`,
    });
    const f = m.el.querySelector('#f-deuda');
    const $ = (id) => f.querySelector(id);
    const err = $('#d-error');
    bindMoney($('#d-saldo'));
    enlazarAtajos(f);
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.hidden = true;
      const saldo = readMoney($('#d-saldo'));
      if (saldo <= 0) return showError(err, 'Escribe cuánto debe.');
      if (!$('#d-cobro').value) return showError(err, 'Elige la fecha en que acordaron el cobro.');
      if (!$('#d-fecha').value) return showError(err, 'Elige la fecha de la deuda.');
      await withBusy(f.querySelector('[type=submit]'), async () => {
        try {
          await q(db.rpc('agregar_deuda', {
            p_cliente_id: cli.id,
            p_saldo: saldo,
            p_fecha_cobro: $('#d-cobro').value,
            p_fecha: $('#d-fecha').value,
            p_lote: $('#d-lote').value ? Number($('#d-lote').value) : null,
            p_observacion: $('#d-obs').value || null,
          }));
          m.close();
          toast('Deuda anotada');
          await cargar(true);
          alTerminar?.();
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
          <button type="button" class="btn btn-suave" data-d="deuda">Anotar deuda</button>
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
          <thead><tr><th>Fecha</th><th>De dónde</th><th>Cobrar el</th><th class="der">Total</th><th class="der">Pagado</th><th class="der">Saldo</th><th>Estado</th></tr></thead>
          <tbody>${ventas.map((v) => {
            const e = ESTV[v.estado] || [esc(v.estado), 'chip-ocre'];
            const origen = v.origen === 'migracion' ? `Cartera anterior${v.lotes ? ` (${esc(v.lotes)})` : ''}` : (v.lotes ? esc(v.lotes) : 'Venta');
            return `<tr>
              <td data-label="Fecha">${fdate(v.fecha)}</td>
              <td data-label="De dónde" class="ancho">${origen}${v.observacion && v.observacion !== 'Cartera migrada' ? `<span class="obs">${esc(v.observacion)}</span>` : ''}</td>
              <td data-label="Cobrar el">${Number(v.saldo) > 0 ? (v.fecha_cobro ? fdate(v.fecha_cobro) : 'Sin fecha') : ''}</td>
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
      m.el.querySelector('[data-d=deuda]').addEventListener('click', () => abrirDeuda({ id, nombre: cli.nombre }, () => pintarDetalle().catch(() => {})));
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
