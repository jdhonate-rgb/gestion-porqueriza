/* Ventas: por kilo, de contado o a crédito, con abonos. Alimenta la cartera, la ruta de cobro y las cuentas. */
import {
  db, q, money, num, fdate, today, addDays, esc, errMsg, toast, modal, errorHtml, loading,
  bindMoney, readMoney, setMoney, withBusy, showError, getLotes, confirmar,
} from '../lib.js';

const ESTADO = {
  pendiente: { txt: 'Sin pago', cls: 'chip-rojo' },
  parcial: { txt: 'Abonada', cls: 'chip-ocre' },
  pagada: { txt: 'Pagada', cls: 'chip-verde' },
};
const METODO = { efectivo: 'Efectivo', transferencia: 'Transferencia' };
const PRESENT = { entero: 'Entero', desprezado: 'Desprezado' };

const radiosMetodo = (name = 'metodo') => `
  <fieldset class="segmento campo"><legend>Método de pago</legend>
    <div class="opciones">
      <label><input type="radio" name="${name}" value="efectivo" checked><span>Efectivo</span></label>
      <label><input type="radio" name="${name}" value="transferencia"><span>Transferencia</span></label>
    </div></fieldset>`;

const atajosFecha = (idCampo) => `<div class="atajos" data-atajos="${idCampo}" role="group" aria-label="Fechas rápidas">
  ${[['Hoy', 0], ['En 8 días', 8], ['En 15 días', 15], ['En 30 días', 30]]
    .map(([t, d]) => `<button type="button" class="btn btn-suave btn-chico" data-dias="${d}">${t}</button>`).join('')}</div>`;
function enlazarAtajos(el) {
  el.querySelectorAll('[data-atajos]').forEach((g) => g.addEventListener('click', (e) => {
    const b = e.target.closest('[data-dias]');
    if (!b) return;
    el.querySelector(`#${g.dataset.atajos}`).value = addDays(today(), Number(b.dataset.dias));
  }));
}

export async function render({ root }) {
  const st = { ventas: [], buscar: '', estado: '', mes: '' };
  let carga = 0;

  root.innerHTML = `
    <header class="page-head">
      <div>
        <h1 tabindex="-1">Ventas</h1>
        <p class="sub">Todas las ventas son por kilo. Si queda saldo, la venta pasa sola a la Ruta de cobro en la fecha pactada.</p>
      </div>
      <button type="button" class="btn btn-primario" id="btn-nueva">Nueva venta</button>
    </header>
    <div id="panel"></div>`;
  const panel = root.querySelector('#panel');
  root.querySelector('#btn-nueva').addEventListener('click', () => abrirVenta());

  panel.addEventListener('click', (e) => {
    if (e.target.closest('[data-reintentar]')) { cargar(); return; }
    const fila = e.target.closest('tr[data-id]');
    if (fila) verVenta(fila.dataset.id);
  });
  panel.addEventListener('input', (e) => {
    if (e.target.id === 'f-buscar') { st.buscar = e.target.value; pintarLista(); }
  });
  panel.addEventListener('change', (e) => {
    if (e.target.id === 'f-estado') { st.estado = e.target.value; pintarLista(); }
    if (e.target.id === 'f-mes') { st.mes = e.target.value; pintarLista(); }
  });

  async function cargar() {
    const mi = ++carga;
    panel.innerHTML = loading();
    try {
      const filas = await q(db.from('v_ventas_detalle').select('*').eq('origen', 'normal')
        .order('fecha', { ascending: false }).order('venta_id'));
      if (mi !== carga) return;
      st.ventas = filas;
      pintar();
    } catch (e) { if (mi === carga) panel.innerHTML = errorHtml(e); }
  }

  function pintar() {
    if (!st.ventas.length) {
      panel.innerHTML = `<div class="vacio"><h2>Aún no hay ventas</h2>
        <p>Registra la primera venta: elige el cliente, los kilos y el precio por kilo. Puede ser de contado o a crédito.</p></div>`;
      return;
    }
    const meses = [...new Set(st.ventas.map((v) => String(v.fecha).slice(0, 7)))].sort().reverse();
    const mesTxt = (ym) => { const [y, m] = ym.split('-'); return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('es-CO', { month: 'long', year: 'numeric' }); };
    panel.innerHTML = `
      <div class="filtros">
        <div class="campo"><label for="f-buscar">Cliente</label><input id="f-buscar" type="search" placeholder="Buscar por nombre" value="${esc(st.buscar)}" autocomplete="off"></div>
        <div class="campo"><label for="f-estado">Estado</label>
          <select id="f-estado"><option value="">Todas</option>
            <option value="pendiente"${st.estado === 'pendiente' ? ' selected' : ''}>Sin pago</option>
            <option value="parcial"${st.estado === 'parcial' ? ' selected' : ''}>Abonadas</option>
            <option value="debe"${st.estado === 'debe' ? ' selected' : ''}>Con saldo (sin pago o abonadas)</option>
            <option value="pagada"${st.estado === 'pagada' ? ' selected' : ''}>Pagadas</option></select></div>
        <div class="campo"><label for="f-mes">Mes</label>
          <select id="f-mes"><option value="">Todo el tiempo</option>${meses.map((ym) => `<option value="${ym}"${st.mes === ym ? ' selected' : ''}>${esc(mesTxt(ym))}</option>`).join('')}</select></div>
      </div>
      <div id="lista"></div>`;
    pintarLista();
  }

  function pintarLista() {
    const cont = panel.querySelector('#lista');
    if (!cont) return;
    const b = st.buscar.trim().toLowerCase();
    const f = st.ventas.filter((v) => (!b || v.cliente.toLowerCase().includes(b))
      && (!st.estado || (st.estado === 'debe' ? Number(v.saldo) > 0 : v.estado === st.estado))
      && (!st.mes || String(v.fecha).startsWith(st.mes)));
    if (!f.length) { cont.innerHTML = '<div class="vacio"><p>No hay ventas con esos filtros.</p></div>'; return; }
    const suma = (k) => f.reduce((a, v) => a + Number(v[k]), 0);
    cont.innerHTML = `
      <div class="tiles">
        <div class="tile"><strong>${money(suma('total'))}</strong><span>Vendido · ${num(suma('kilos'))} kg</span></div>
        <div class="tile"><strong class="ok">${money(suma('pagado'))}</strong><span>Cobrado</span></div>
        <div class="tile"><strong class="${suma('saldo') > 0 ? 'deuda' : ''}">${money(suma('saldo'))}</strong><span>Por cobrar</span></div>
      </div>
      <div class="tabla-wrap"><table class="tabla ancha">
        <thead><tr><th>Fecha</th><th>Cliente</th><th class="der">Kilos</th><th class="der">Total</th><th class="der">Pagado</th><th class="der">Saldo</th><th>Estado</th></tr></thead>
        <tbody>${f.map((v) => {
          const e = ESTADO[v.estado] || ESTADO.pendiente;
          return `<tr data-id="${esc(v.venta_id)}" class="fila-click" tabindex="0">
            <td data-label="Fecha">${fdate(v.fecha)}</td>
            <td data-label="Cliente" class="ancho"><strong>${esc(v.cliente)}</strong>
              <span class="obs">${v.tipo_venta === 'contado' ? 'De contado' : 'A crédito'}${Number(v.saldo) > 0 && v.fecha_cobro ? ` · cobro ${fdate(v.fecha_cobro)}` : ''}</span></td>
            <td data-label="Kilos" class="der">${num(v.kilos)}</td>
            <td data-label="Total" class="der">${money(v.total)}</td>
            <td data-label="Pagado" class="der">${money(v.pagado)}</td>
            <td data-label="Saldo" class="der ${Number(v.saldo) > 0 ? 'deuda' : ''}">${money(v.saldo)}</td>
            <td data-label="Estado"><span class="chip ${e.cls}">${e.txt}</span></td>
          </tr>`;
        }).join('')}</tbody></table></div>`;
    cont.querySelectorAll('tr.fila-click').forEach((tr) => tr.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') verVenta(tr.dataset.id); }));
  }

  /* ---------- Detalle ---------- */
  async function verVenta(id) {
    const m = modal({ title: 'Venta', html: loading(), wide: true });
    const refrescar = async () => {
      try {
        const [v, items, pagos] = await Promise.all([
          q(db.from('v_ventas_detalle').select('*').eq('venta_id', id).single()),
          q(db.from('venta_items').select('*').eq('venta_id', id).order('id')),
          q(db.from('pagos_venta').select('*').eq('venta_id', id).order('fecha').order('created_at')),
        ]);
        const ids = [...new Set(items.map((i) => i.sacrificio_id))];
        const sacs = ids.length ? await q(db.from('sacrificios').select('id,fecha,lote_id').in('id', ids)) : [];
        items.forEach((i) => { i.sacrificios = sacs.find((x) => x.id === i.sacrificio_id); });
        const lotes = await getLotes();
        const nombreLote = (lid) => (lotes.find((l) => l.id === lid) || {}).nombre || `Lote ${lid}`;
        const e = ESTADO[v.estado] || ESTADO.pendiente;
        const pct = Number(v.total) > 0 ? Math.min(100, Math.round((Number(v.pagado) / Number(v.total)) * 100)) : 100;
        m.setBody(`
          <div class="detalle-venta">
            <div class="det-cab"><div>
              <h3>${esc(v.cliente)}</h3>
              <p class="sub">${fdate(v.fecha)} · ${v.tipo_venta === 'contado' ? 'De contado' : 'A crédito'}</p></div>
              <span class="chip ${e.cls}">${e.txt}</span></div>
            <div class="tiles">
              <div class="tile"><strong>${money(v.total)}</strong><span>Total · ${num(v.kilos)} kg</span></div>
              <div class="tile"><strong class="ok">${money(v.pagado)}</strong><span>Pagado</span></div>
              <div class="tile"><strong class="${Number(v.saldo) > 0 ? 'deuda' : ''}">${money(v.saldo)}</strong><span>Saldo</span></div>
            </div>
            <div class="progreso" aria-hidden="true"><div class="barra"><i style="width:${pct}%"></i></div></div>
            ${Number(v.saldo) > 0 ? `<p class="ayuda">Cobro pactado: <strong>${v.fecha_cobro ? fdate(v.fecha_cobro) : 'sin fecha'}</strong>${v.dias_para_cobro != null && v.dias_para_cobro < 0 ? ` · <span class="deuda">atrasada ${-v.dias_para_cobro} días</span>` : ''}</p>` : ''}
            ${v.observacion ? `<p class="ayuda">${esc(v.observacion)}</p>` : ''}
            <h4>Lo que se vendió</h4>
            <div class="tabla-wrap"><table class="tabla ancha"><thead><tr><th>Origen</th><th>Presentación</th><th class="der">Cerdos</th><th class="der">Kilos</th><th class="der">Precio/kg</th><th class="der">Subtotal</th></tr></thead>
              <tbody>${items.map((i) => `<tr>
                <td data-label="Origen">${esc(nombreLote(i.sacrificios?.lote_id))} · sacrificio ${fdate(i.sacrificios?.fecha)}</td>
                <td data-label="Presentación">${PRESENT[i.presentacion]}</td>
                <td data-label="Cerdos" class="der">${i.cantidad_cerdos ?? '—'}</td>
                <td data-label="Kilos" class="der">${num(i.kilos)}</td>
                <td data-label="Precio/kg" class="der">${money(i.precio_kilo)}</td>
                <td data-label="Subtotal" class="der">${money(i.subtotal)}</td></tr>`).join('')}</tbody></table></div>
            <h4>Pagos recibidos</h4>
            ${pagos.length ? `<div class="tabla-wrap"><table class="tabla ancha"><thead><tr><th>Fecha</th><th>Método</th><th class="der">Valor</th><th></th></tr></thead>
              <tbody>${pagos.map((p) => `<tr>
                <td data-label="Fecha">${fdate(p.fecha)}</td>
                <td data-label="Método">${esc(METODO[p.metodo] || p.metodo)}${p.cobro_id ? ' <span class="chip chip-neutro">Ruta de cobro</span>' : ''}</td>
                <td data-label="Valor" class="der">${money(p.monto)}</td>
                <td class="acc"><button type="button" class="btn-texto peligro" data-pago="${esc(p.id)}" data-monto="${esc(p.monto)}">Anular pago</button></td></tr>`).join('')}</tbody></table></div>`
              : '<p class="ayuda">Todavía no hay pagos.</p>'}
            <div class="acciones-form separado">
              ${Number(v.saldo) > 0 ? '<button type="button" class="btn btn-primario" data-d="pagar">Registrar pago</button>' : ''}
              <button type="button" class="btn btn-suave" data-d="editar">Editar venta</button>
              <button type="button" class="btn-texto peligro" data-d="borrar">Eliminar venta</button>
            </div>
          </div>`);
        enlazar(v);
      } catch (e) { m.setBody(errorHtml(e)); }
    };
    const enlazar = (v) => {
      m.el.querySelector('[data-d=pagar]')?.addEventListener('click', () => abrirPago(v, refrescar));
      m.el.querySelector('[data-d=editar]')?.addEventListener('click', () => abrirVenta(v, async () => { await refrescar(); await cargar(); }));
      m.el.querySelector('[data-d=borrar]')?.addEventListener('click', async () => {
        const ok = await confirmar({ titulo: 'Eliminar venta', texto: `Se borra la venta de <strong>${esc(v.cliente)}</strong> por <strong>${money(v.total)}</strong> y los kilos vuelven a estar disponibles. Esto no se puede deshacer.`, boton: 'Eliminar' });
        if (!ok) return;
        try { await q(db.rpc('eliminar_venta', { p_venta_id: v.venta_id })); m.close(); toast('Venta eliminada'); await cargar(); }
        catch (ex) { toast(errMsg(ex), 'mal'); }
      });
      m.el.querySelectorAll('[data-pago]').forEach((b) => b.addEventListener('click', async () => {
        const ok = await confirmar({ titulo: 'Anular pago', texto: `Se anula el pago de <strong>${money(b.dataset.monto)}</strong> y ese valor vuelve a quedar como saldo.`, boton: 'Anular pago' });
        if (!ok) return;
        try { await q(db.rpc('anular_cobro', { p_pago_id: b.dataset.pago })); toast('Pago anulado'); await refrescar(); await cargar(); }
        catch (ex) { toast(errMsg(ex), 'mal'); }
      }));
    };
    await refrescar();
  }

  /* ---------- Registrar pago ---------- */
  function abrirPago(v, alTerminar) {
    const m = modal({
      title: `Pago de ${v.cliente}`,
      html: `<form id="f-pago" novalidate>
        <p class="ayuda">Saldo de esta venta: <strong>${money(v.saldo)}</strong></p>
        <div class="rejilla">
          <div class="campo"><label for="p-monto">Valor recibido</label><input id="p-monto" type="text" inputmode="numeric" autocomplete="off" placeholder="$ 0" required></div>
          <div class="campo"><label for="p-fecha">Fecha</label><input id="p-fecha" type="date" value="${today()}"></div>
        </div>
        <button type="button" class="btn btn-suave btn-chico" id="p-todo">Pagó todo el saldo</button>
        ${radiosMetodo()}
        <p class="error" id="p-error" role="alert" hidden></p>
        <div class="acciones-form"><button type="button" class="btn btn-suave" data-cerrar>Cancelar</button>
          <button type="submit" class="btn btn-primario">Guardar pago</button></div></form>`,
    });
    const f = m.el.querySelector('#f-pago');
    const campo = f.querySelector('#p-monto');
    bindMoney(campo);
    f.querySelector('#p-todo').addEventListener('click', () => setMoney(campo, Number(v.saldo)));
    const err = f.querySelector('#p-error');
    f.addEventListener('submit', async (e) => {
      e.preventDefault(); err.hidden = true;
      const monto = readMoney(campo);
      if (monto <= 0) return showError(err, 'Escribe el valor recibido.');
      if (monto > Number(v.saldo)) return showError(err, `El pago no puede ser mayor que el saldo (${money(v.saldo)}).`);
      await withBusy(f.querySelector('[type=submit]'), async () => {
        try {
          await q(db.rpc('registrar_pago_venta', {
            p_venta_id: v.venta_id, p_monto: monto,
            p_metodo: f.querySelector('input[name=metodo]:checked').value, p_fecha: f.querySelector('#p-fecha').value || today(),
          }));
          m.close(); toast('Pago guardado'); await alTerminar(); await cargar();
        } catch (ex) { showError(err, errMsg(ex)); }
      });
    });
  }

  /* ---------- Crear / editar venta ---------- */
  async function abrirVenta(venta, alTerminar) {
    const edita = !!venta;
    const m = modal({ title: edita ? 'Editar venta' : 'Nueva venta', html: loading(), wide: true });
    let clientes; let canal; let cartera; let itemsPrev = []; let pagosPrev = [];
    try {
      [clientes, canal, cartera] = await Promise.all([
        q(db.from('clientes').select('id,nombre,telefono').eq('activo', true).order('nombre')),
        q(db.from('v_canal_disponible').select('*').order('fecha', { ascending: false })),
        q(db.from('v_cartera_clientes').select('cliente_id,saldo_total,dias_deuda_mas_antigua')),
      ]);
      if (edita) {
        itemsPrev = await q(db.from('venta_items').select('*').eq('venta_id', venta.venta_id).order('id'));
        pagosPrev = await q(db.from('pagos_venta').select('metodo').eq('venta_id', venta.venta_id));
      }
    } catch (e) { m.setBody(errorHtml(e)); return; }
    const lotes = await getLotes();
    const nombreLote = (id) => (lotes.find((l) => l.id === id) || {}).nombre || `Lote ${id}`;
    // en edición, los kilos de esta misma venta cuentan como disponibles
    const propios = {};
    itemsPrev.forEach((i) => { propios[i.sacrificio_id] = (propios[i.sacrificio_id] || 0) + Number(i.kilos); });
    const opciones = canal.map((c) => ({ ...c, disp: Number(c.kilos_disponibles) + (propios[c.sacrificio_id] || 0) }))
      .filter((c) => c.disp > 0);
    if (!opciones.length) {
      m.setBody(`<div class="vacio"><h2>No hay carne disponible para vender</h2>
        <p>Primero registra un sacrificio en el módulo Sacrificio. Aquí se vende lo que quedó del peso en canal.</p>
        <div class="acciones-form"><button type="button" class="btn btn-suave" data-cerrar>Entendido</button></div></div>`);
      return;
    }
    const optSac = (sel) => opciones.map((c) => `<option value="${esc(c.sacrificio_id)}"${c.sacrificio_id === sel ? ' selected' : ''}>${esc(nombreLote(c.lote_id))} · ${fdate(c.fecha)} · quedan ${num(c.disp)} kg</option>`).join('');

    const metodoPrev = pagosPrev[0]?.metodo || 'efectivo';
    m.setBody(`<form id="f-venta" novalidate>
      <div class="rejilla">
        <div class="campo"><label for="v-cliente">Cliente</label>
          <select id="v-cliente"><option value="">Elige un cliente…</option>
            ${clientes.map((c) => `<option value="${esc(c.id)}">${esc(c.nombre)}</option>`).join('')}
            ${edita ? '' : '<option value="__nuevo__">＋ Cliente nuevo…</option>'}</select></div>
        <div class="campo"><label for="v-fecha">Fecha de la venta</label><input id="v-fecha" type="date" value="${esc(edita ? venta.fecha : today())}"></div>
      </div>
      <div id="v-nuevo" class="rejilla" hidden>
        <div class="campo"><label for="vn-nombre">Nombre del cliente nuevo</label><input id="vn-nombre" type="text" autocomplete="off"></div>
        <div class="campo"><label for="vn-tel">Teléfono (opcional)</label><input id="vn-tel" type="tel" inputmode="tel" autocomplete="off"></div>
      </div>
      <p class="aviso-cartera" id="v-aviso" hidden></p>
      <fieldset class="segmento campo"><legend>Forma de pago</legend>
        <div class="opciones">
          <label><input type="radio" name="v-tipo" value="contado"${edita && venta.tipo_venta === 'credito' ? '' : ' checked'}${edita ? ' disabled' : ''}><span>De contado</span></label>
          <label><input type="radio" name="v-tipo" value="credito"${edita && venta.tipo_venta === 'credito' ? ' checked' : ''}${edita ? ' disabled' : ''}><span>A crédito</span></label>
        </div></fieldset>

      <h3 class="sub-titulo">Qué se vende</h3>
      <div id="v-items"></div>
      <button type="button" class="btn btn-suave btn-chico" id="v-mas">＋ Agregar otro corte</button>
      <p class="total-linea">Total de la venta <strong id="v-total">$ 0</strong></p>

      <div id="v-bloque-contado">${radiosMetodo('v-metodo')}</div>
      <div id="v-bloque-credito" hidden>
        <div class="rejilla">
          <div class="campo"><label for="v-abono">Abono al vender (opcional)</label><input id="v-abono" type="text" inputmode="numeric" autocomplete="off" placeholder="$ 0"${edita ? ' disabled' : ''}></div>
          <div class="campo"><label for="v-cobro">Fecha pactada de cobro del saldo</label><input id="v-cobro" type="date" value="${esc(edita && venta.fecha_cobro ? venta.fecha_cobro : '')}"></div>
        </div>
        ${atajosFecha('v-cobro')}
        <div id="v-metodo-abono">${edita ? '' : radiosMetodo('v-metodo2')}</div>
        <p class="ayuda" id="v-saldo-txt"></p>
      </div>
      <div class="campo"><label for="v-obs">Observación (opcional)</label><textarea id="v-obs" rows="2">${esc(edita ? venta.observacion || '' : '')}</textarea></div>
      <p class="error" id="v-error" role="alert" hidden></p>
      <div class="acciones-form"><button type="button" class="btn btn-suave" data-cerrar>Cancelar</button>
        <button type="submit" class="btn btn-primario">${edita ? 'Guardar cambios' : 'Guardar venta'}</button></div>
    </form>`);

    const f = m.el.querySelector('#f-venta');
    const $ = (s) => f.querySelector(s);
    const err = $('#v-error');
    enlazarAtajos(f);
    bindMoney($('#v-abono'));
    if (edita) { $('#v-cliente').value = venta.cliente_id; }

    /* ítems */
    const itemsEl = $('#v-items');
    let n = 0;
    const filaItem = (it) => {
      const id = ++n;
      const sel = it?.sacrificio_id || opciones[0].sacrificio_id;
      const div = document.createElement('div');
      div.className = 'item-venta';
      div.innerHTML = `
        <div class="rejilla">
          <div class="campo"><label for="i-sac-${id}">Origen (sacrificio)</label><select id="i-sac-${id}" data-k="sac">${optSac(sel)}</select></div>
          <div class="campo"><label for="i-pre-${id}">Presentación</label>
            <select id="i-pre-${id}" data-k="pre"><option value="desprezado"${it?.presentacion === 'desprezado' || !it ? ' selected' : ''}>Desprezado (solo kilos)</option>
              <option value="entero"${it?.presentacion === 'entero' ? ' selected' : ''}>Entero (cuenta cerdos)</option></select></div>
          <div class="campo" data-c="cerdos" hidden><label for="i-cer-${id}">Cerdos</label><input id="i-cer-${id}" data-k="cer" type="number" min="1" step="1" inputmode="numeric" value="${esc(it?.cantidad_cerdos ?? '')}"></div>
          <div class="campo"><label for="i-kg-${id}">Kilos</label><input id="i-kg-${id}" data-k="kg" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(it?.kilos ?? '')}"></div>
          <div class="campo"><label for="i-pre2-${id}">Precio por kilo</label><input id="i-pre2-${id}" data-k="precio" type="text" inputmode="numeric" autocomplete="off" placeholder="$ 0"></div>
        </div>
        <div class="item-pie"><span class="item-sub" data-k="sub">$ 0</span>
          <button type="button" class="btn-texto peligro" data-k="quitar">Quitar</button></div>`;
      itemsEl.appendChild(div);
      bindMoney(div.querySelector('[data-k=precio]'));
      if (it) setMoney(div.querySelector('[data-k=precio]'), Number(it.precio_kilo));
      div.querySelector('[data-k=quitar]').addEventListener('click', () => { if (itemsEl.children.length > 1) { div.remove(); recalc(); } else toast('La venta necesita al menos un corte', 'mal'); });
      div.addEventListener('input', recalc);
      div.addEventListener('change', recalc);
      recalc();
    };
    const leerItems = () => [...itemsEl.children].map((d) => {
      const g = (k) => d.querySelector(`[data-k=${k}]`);
      const pre = g('pre').value;
      return { sacrificio_id: g('sac').value, presentacion: pre,
        cantidad_cerdos: pre === 'entero' ? Number(g('cer').value || 0) : null,
        kilos: Number(g('kg').value || 0), precio_kilo: readMoney(g('precio')), _d: d };
    });
    function recalc() {
      let total = 0;
      leerItems().forEach((it) => {
        const sub = Math.round(it.kilos * it.precio_kilo);
        it._d.querySelector('[data-c=cerdos]').hidden = it.presentacion !== 'entero';
        it._d.querySelector('[data-k=sub]').textContent = money(sub);
        total += sub;
      });
      $('#v-total').textContent = money(total);
      const tipo = f.querySelector('input[name=v-tipo]:checked').value;
      $('#v-bloque-contado').hidden = tipo !== 'contado';
      $('#v-bloque-credito').hidden = tipo !== 'credito';
      if (tipo === 'credito') {
        const abono = readMoney($('#v-abono'));
        $('#v-saldo-txt').innerHTML = `Quedará debiendo <strong>${money(Math.max(0, total - abono))}</strong>.`;
        $('#v-metodo-abono').hidden = abono <= 0;
      }
    }
    (edita && itemsPrev.length ? itemsPrev : [null]).forEach(filaItem);
    $('#v-mas').addEventListener('click', () => filaItem());
    f.querySelectorAll('input[name=v-tipo]').forEach((r) => r.addEventListener('change', recalc));
    $('#v-abono').addEventListener('input', recalc);
    if (edita) f.querySelector(`input[name=v-metodo][value=${metodoPrev}]`)?.click();

    /* cliente nuevo y aviso de cartera */
    const aviso = () => {
      const val = $('#v-cliente').value;
      $('#v-nuevo').hidden = val !== '__nuevo__';
      const c = cartera.find((x) => x.cliente_id === val);
      const el = $('#v-aviso');
      if (c && Number(c.saldo_total) > 0) {
        el.hidden = false;
        el.innerHTML = `Ojo: este cliente ya debe <strong>${money(c.saldo_total)}</strong>${c.dias_deuda_mas_antigua != null ? ` desde hace ${c.dias_deuda_mas_antigua} días` : ''}. Puedes venderle igual.`;
      } else el.hidden = true;
    };
    $('#v-cliente').addEventListener('change', aviso);
    aviso();

    f.addEventListener('submit', async (e) => {
      e.preventDefault(); err.hidden = true;
      const tipo = f.querySelector('input[name=v-tipo]:checked').value;
      let clienteId = $('#v-cliente').value;
      if (!clienteId) return showError(err, 'Elige el cliente.');
      if (clienteId === '__nuevo__' && !$('#vn-nombre').value.trim()) return showError(err, 'Escribe el nombre del cliente nuevo.');
      if (!$('#v-fecha').value) return showError(err, 'Elige la fecha de la venta.');
      const items = leerItems();
      for (const [i, it] of items.entries()) {
        const x = items.length > 1 ? ` (corte ${i + 1})` : '';
        if (!(it.kilos > 0)) return showError(err, `Escribe los kilos${x}.`);
        if (!(it.precio_kilo > 0)) return showError(err, `Escribe el precio por kilo${x}.`);
        if (it.presentacion === 'entero' && !(it.cantidad_cerdos > 0)) return showError(err, `Escribe cuántos cerdos son${x}.`);
        const disp = opciones.find((o) => o.sacrificio_id === it.sacrificio_id)?.disp ?? 0;
        const mismos = items.filter((o) => o.sacrificio_id === it.sacrificio_id).reduce((a, o) => a + o.kilos, 0);
        if (mismos > disp + 0.001) return showError(err, `De ese sacrificio solo quedan ${num(disp)} kg disponibles${x}.`);
      }
      const total = items.reduce((a, it) => a + Math.round(it.kilos * it.precio_kilo), 0);
      const abono = tipo === 'credito' && !edita ? readMoney($('#v-abono')) : 0;
      const fcobro = $('#v-cobro').value || null;
      if (tipo === 'credito' && abono > total) return showError(err, 'El abono no puede ser mayor que el total de la venta.');
      if (tipo === 'credito' && total - abono > 0 && !fcobro) return showError(err, 'Escribe la fecha pactada de cobro del saldo, así sabrás quién está atrasado.');
      const payloadItems = items.map(({ _d, ...r }) => r);
      await withBusy(f.querySelector('[type=submit]'), async () => {
        try {
          if (clienteId === '__nuevo__') {
            clienteId = await q(db.rpc('crear_cliente', { p_nombre: $('#vn-nombre').value.trim(), p_telefono: $('#vn-tel').value.trim() || null }));
          }
          const obs = $('#v-obs').value.trim() || null;
          if (edita) {
            await q(db.rpc('editar_venta', {
              p_venta_id: venta.venta_id, p_fecha: $('#v-fecha').value, p_cliente_id: clienteId, p_items: payloadItems,
              p_fecha_cobro: tipo === 'credito' ? fcobro : null, p_observacion: obs,
              p_metodo: tipo === 'contado' ? f.querySelector('input[name=v-metodo]:checked').value : null,
            }));
          } else {
            await q(db.rpc('crear_venta', {
              p_fecha: $('#v-fecha').value, p_cliente_id: clienteId, p_tipo_venta: tipo, p_items: payloadItems,
              p_metodo: tipo === 'contado' ? f.querySelector('input[name=v-metodo]:checked').value
                : (abono > 0 ? f.querySelector('input[name=v-metodo2]:checked').value : null),
              p_observacion: obs, p_fecha_cobro: tipo === 'credito' ? fcobro : null, p_abono: abono,
            }));
          }
          m.close(); toast(edita ? 'Venta actualizada' : 'Venta guardada');
          if (alTerminar) await alTerminar(); else await cargar();
        } catch (ex) { showError(err, errMsg(ex)); }
      });
    });
  }

  cargar();
}
