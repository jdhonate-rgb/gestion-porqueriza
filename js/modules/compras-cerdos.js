/* Compra de cerdos: compras con adelanto/abonos/pago total, y partos de las cerdas */
import {
  db, q, money, num, fdate, today, esc, errMsg, toast, modal, errorHtml, loading,
  bindMoney, readMoney, setMoney, withBusy, showError, getLotes,
} from '../lib.js';

const ESTADO = {
  sin_pago: { txt: 'Sin pago', cls: 'chip-rojo' },
  abonado: { txt: 'Abonado', cls: 'chip-ocre' },
  pagado: { txt: 'Pagado', cls: 'chip-verde' },
};
const METODO = { efectivo: 'Efectivo', transferencia: 'Transferencia' };
const CONCEPTO = { adelanto: 'Adelanto', abono: 'Abono', pago_total: 'Pago total' };

const pct = (pagado, total) => (total > 0 ? Math.min(100, Math.round((pagado / total) * 100)) : 100);

const radiosMetodo = (name = 'metodo') => `
  <fieldset class="segmento campo"><legend>Método de pago</legend>
    <div class="opciones">
      <label><input type="radio" name="${name}" value="efectivo" checked><span>Efectivo</span></label>
      <label><input type="radio" name="${name}" value="transferencia"><span>Transferencia</span></label>
    </div>
  </fieldset>`;

export async function render({ root }) {
  const lotes = await getLotes();
  const nombreLote = (id) => lotes.find((l) => l.id === id)?.nombre ?? `Lote ${id}`;
  const st = { tab: 'compras', compras: [], partos: [], fLote: '', fEstado: '' };
  let carga = 0;

  root.innerHTML = `
    <header class="page-head">
      <div>
        <h1 tabindex="-1">Compra de cerdos</h1>
        <p class="sub">Compras con adelanto, abonos o pago total, y los partos de las cerdas.</p>
      </div>
      <button type="button" class="btn btn-primario" id="btn-nuevo">Nueva compra</button>
    </header>
    <div class="tabs" role="tablist" aria-label="Secciones">
      <button type="button" role="tab" id="tab-compras" aria-selected="true" aria-controls="panel">Compras</button>
      <button type="button" role="tab" id="tab-partos" aria-selected="false" aria-controls="panel">Partos</button>
    </div>
    <div id="panel" role="tabpanel"></div>`;

  const panel = root.querySelector('#panel');
  const btnNuevo = root.querySelector('#btn-nuevo');

  /* ---------- Pestañas ---------- */
  root.querySelectorAll('[role=tab]').forEach((t) => t.addEventListener('click', () => {
    st.tab = t.id === 'tab-partos' ? 'partos' : 'compras';
    root.querySelectorAll('[role=tab]').forEach((x) => x.setAttribute('aria-selected', String(x === t)));
    btnNuevo.textContent = st.tab === 'partos' ? 'Registrar parto' : 'Nueva compra';
    cargar();
  }));
  btnNuevo.addEventListener('click', () => (st.tab === 'partos' ? abrirParto() : abrirCompra()));
  panel.addEventListener('click', (e) => {
    if (e.target.closest('[data-reintentar]')) { cargar(); return; }
    const fila = e.target.closest('tr[data-id]');
    if (fila && st.tab === 'compras') verCompra(fila.dataset.id);
  });

  /* ---------- Carga ---------- */
  async function cargar() {
    const mi = ++carga;
    panel.innerHTML = loading();
    try {
      if (st.tab === 'compras') {
        const filas = await q(db.from('v_compras_cerdos_saldo').select('*').order('fecha', { ascending: false }));
        if (mi !== carga) return;
        st.compras = filas;
        pintarCompras();
      } else {
        const filas = await q(db.from('compras_cerdos')
          .select('id,fecha,lote_id,lote_origen_id,cantidad,valor_unitario,total,observacion')
          .eq('tipo', 'nacimiento').order('fecha', { ascending: false }));
        if (mi !== carga) return;
        st.partos = filas;
        pintarPartos();
      }
    } catch (e) {
      if (mi === carga) panel.innerHTML = errorHtml(e);
    }
  }

  /* ---------- Lista de compras ---------- */
  function pintarCompras() {
    panel.innerHTML = `
      <div class="filtros">
        <div class="campo"><label for="f-lote">Lote</label>
          <select id="f-lote"><option value="">Todos</option>
            ${lotes.map((l) => `<option value="${l.id}">${esc(l.nombre)}</option>`).join('')}</select></div>
        <div class="campo"><label for="f-estado">Estado de pago</label>
          <select id="f-estado"><option value="">Todos</option>
            <option value="sin_pago">Sin pago</option><option value="abonado">Abonado</option><option value="pagado">Pagado</option></select></div>
      </div>
      <div id="lista"></div>`;
    const fLote = panel.querySelector('#f-lote');
    const fEstado = panel.querySelector('#f-estado');
    fLote.value = st.fLote; fEstado.value = st.fEstado;
    fLote.addEventListener('change', () => { st.fLote = fLote.value; pintarLista(); });
    fEstado.addEventListener('change', () => { st.fEstado = fEstado.value; pintarLista(); });
    pintarLista();
  }

  function pintarLista() {
    const cont = panel.querySelector('#lista');
    if (!st.compras.length) {
      cont.innerHTML = `<div class="vacio"><h2>Aún no hay compras registradas</h2>
        <p>Registra la primera compra de cerdos. Si apartas el lote con un adelanto, el saldo queda pendiente y lo abonas cuando pagues.</p></div>`;
      return;
    }
    const f = st.compras.filter((c) => (!st.fLote || String(c.lote_id) === st.fLote) && (!st.fEstado || c.estado_pago === st.fEstado));
    if (!f.length) { cont.innerHTML = '<div class="vacio"><p>No hay compras con esos filtros.</p></div>'; return; }

    const suma = (k) => f.reduce((a, c) => a + Number(c[k]), 0);
    cont.innerHTML = `
      <dl class="resumen">
        <div><dt>Total comprado</dt><dd>${money(suma('total'))}</dd></div>
        <div><dt>Pagado</dt><dd>${money(suma('pagado'))}</dd></div>
        <div><dt>Por pagar</dt><dd class="${suma('saldo') > 0 ? 'deuda' : ''}">${money(suma('saldo'))}</dd></div>
      </dl>
      <div class="tabla-wrap"><table class="tabla ancha">
        <thead><tr><th>Fecha</th><th>Lote</th><th>Compra</th><th class="der">Total</th><th>Pagado</th><th class="der">Saldo</th><th>Estado</th><th><span class="sr">Acciones</span></th></tr></thead>
        <tbody>${f.map(filaCompra).join('')}</tbody>
      </table></div>`;
  }

  function filaCompra(c) {
    const est = ESTADO[c.estado_pago] || ESTADO.sin_pago;
    const p = pct(Number(c.pagado), Number(c.total));
    return `<tr data-id="${esc(c.id)}">
      <td data-label="Fecha">${fdate(c.fecha)}</td>
      <td data-label="Lote">${esc(nombreLote(c.lote_id))}</td>
      <td data-label="Compra" class="ancho">${num(c.cantidad)} ${Number(c.cantidad) === 1 ? 'cerdo' : 'cerdos'} a ${money(c.valor_unitario)}
        ${c.observacion ? `<span class="obs">${esc(c.observacion)}</span>` : ''}</td>
      <td data-label="Total" class="der">${money(c.total)}</td>
      <td data-label="Pagado"><div class="pago"><div class="barra" role="img" aria-label="Pagado ${p} %"><span style="width:${p}%"></span></div>${money(c.pagado)}</div></td>
      <td data-label="Saldo" class="der ${Number(c.saldo) > 0 ? 'deuda' : ''}">${money(c.saldo)}</td>
      <td data-label="Estado"><span class="chip ${est.cls}">${est.txt}</span></td>
      <td class="acc"><button type="button" class="btn btn-suave" data-ver>Ver</button></td>
    </tr>`;
  }

  /* ---------- Lista de partos ---------- */
  function pintarPartos() {
    if (!st.partos.length) {
      panel.innerHTML = `<div class="vacio"><h2>Aún no hay partos registrados</h2>
        <p>Cuando una cerda del lote 7 para, regístralo aquí. Tú decides el valor de cada lechón y a qué lote van; ese valor cuenta como inversión del lote destino y como ingreso de las cerdas.</p></div>`;
      return;
    }
    const total = st.partos.reduce((a, p) => a + Number(p.total), 0);
    const lechones = st.partos.reduce((a, p) => a + Number(p.cantidad), 0);
    panel.innerHTML = `
      <dl class="resumen">
        <div><dt>Lechones nacidos</dt><dd>${num(lechones)}</dd></div>
        <div><dt>Valor asignado</dt><dd>${money(total)}</dd></div>
      </dl>
      <div class="tabla-wrap"><table class="tabla ancha">
        <thead><tr><th>Fecha</th><th>De</th><th>Va al</th><th class="der">Lechones</th><th class="der">Valor por lechón</th><th class="der">Valor total</th><th>Observación</th></tr></thead>
        <tbody>${st.partos.map((p) => `<tr>
          <td data-label="Fecha">${fdate(p.fecha)}</td>
          <td data-label="De">${esc(nombreLote(p.lote_origen_id))}</td>
          <td data-label="Va al">${esc(nombreLote(p.lote_id))}</td>
          <td data-label="Lechones" class="der">${num(p.cantidad)}</td>
          <td data-label="Valor por lechón" class="der">${money(p.valor_unitario)}</td>
          <td data-label="Valor total" class="der">${money(p.total)}</td>
          <td data-label="Observación" class="ancho">${p.observacion ? esc(p.observacion) : ''}</td>
        </tr>`).join('')}</tbody>
      </table></div>`;
  }

  /* ---------- Nueva compra ---------- */
  function abrirCompra() {
    const m = modal({
      title: 'Nueva compra de cerdos',
      html: `<form id="f-compra" novalidate>
        <div class="rejilla">
          <div class="campo"><label for="c-fecha">Fecha de compra</label>
            <input id="c-fecha" type="date" value="${today()}" required></div>
          <div class="campo"><label for="c-lote">Lote destino</label>
            <select id="c-lote" required><option value="">Elige el lote</option>
              ${lotes.map((l) => `<option value="${l.id}">${esc(l.nombre)}</option>`).join('')}</select></div>
          <div class="campo"><label for="c-cant">Cantidad de cerdos</label>
            <input id="c-cant" type="number" inputmode="numeric" min="1" step="1" required></div>
          <div class="campo"><label for="c-valor">Valor por cerdo</label>
            <input id="c-valor" type="text" inputmode="numeric" autocomplete="off" placeholder="$ 0" required></div>
        </div>
        <p class="total-linea"><span>Total a pagar</span><strong id="c-total">${money(0)}</strong></p>
        <div class="campo"><label for="c-obs">Observación</label>
          <textarea id="c-obs" rows="2"></textarea>
          <span class="ayuda">Aquí se escribe a quién se le compra y cualquier detalle del trato.</span></div>
        <fieldset class="segmento campo"><legend>Pago</legend>
          <div class="opciones">
            <label><input type="radio" name="pago" value="ninguno" checked><span>Sin pago todavía</span></label>
            <label><input type="radio" name="pago" value="adelanto"><span>Adelanto</span></label>
            <label><input type="radio" name="pago" value="total"><span>Pago total</span></label>
          </div>
        </fieldset>
        <div id="c-pago" hidden>
          <div class="rejilla">
            <div class="campo"><label for="c-monto">Valor pagado</label>
              <input id="c-monto" type="text" inputmode="numeric" autocomplete="off" placeholder="$ 0"></div>
            ${radiosMetodo()}
          </div>
        </div>
        <p class="error" id="c-error" role="alert" hidden></p>
        <div class="acciones-form">
          <button type="button" class="btn btn-suave" data-cerrar>Cancelar</button>
          <button type="submit" class="btn btn-primario">Guardar compra</button>
        </div>
      </form>`,
    });
    const f = m.el.querySelector('#f-compra');
    const $ = (id) => f.querySelector(id);
    const err = $('#c-error');
    bindMoney($('#c-valor')); bindMoney($('#c-monto'));

    const modo = () => f.querySelector('input[name=pago]:checked').value;
    const totalActual = () => Math.round((Number($('#c-cant').value) || 0) * readMoney($('#c-valor')));
    function actualizar() {
      const total = totalActual();
      $('#c-total').textContent = money(total);
      $('#c-pago').hidden = modo() === 'ninguno';
      const monto = $('#c-monto');
      monto.readOnly = modo() === 'total';
      if (modo() === 'total') setMoney(monto, total);
    }
    f.addEventListener('input', actualizar);
    f.addEventListener('change', actualizar);

    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.hidden = true;
      const lote = Number($('#c-lote').value);
      const cant = Number($('#c-cant').value);
      const valor = readMoney($('#c-valor'));
      const total = totalActual();
      const monto = modo() === 'ninguno' ? 0 : readMoney($('#c-monto'));
      if (!$('#c-fecha').value) return showError(err, 'Elige la fecha de la compra.');
      if (!lote) return showError(err, 'Elige el lote al que van los cerdos.');
      if (!Number.isInteger(cant) || cant < 1) return showError(err, 'La cantidad de cerdos debe ser un número entero mayor que cero.');
      if (valor <= 0) return showError(err, 'Escribe el valor por cerdo.');
      if (modo() !== 'ninguno' && monto <= 0) return showError(err, 'Escribe el valor pagado.');
      if (monto > total) return showError(err, `El pago no puede ser mayor que el total (${money(total)}).`);

      await withBusy(f.querySelector('[type=submit]'), async () => {
        try {
          await q(db.rpc('registrar_compra_cerdos', {
            p_fecha: $('#c-fecha').value,
            p_lote_id: lote,
            p_cantidad: cant,
            p_valor_unitario: valor,
            p_observacion: $('#c-obs').value.trim() || null,
            p_pago_inicial: monto,
            p_metodo: monto > 0 ? f.querySelector('input[name=metodo]:checked').value : null,
          }));
          m.close();
          toast('Compra guardada');
          cargar();
        } catch (ex) { showError(err, errMsg(ex)); }
      });
    });
  }

  /* ---------- Detalle de una compra y abonos ---------- */
  async function verCompra(id) {
    const m = modal({ title: 'Detalle de la compra', html: loading(), wide: true });

    async function pintar() {
      const [c, pagos] = await Promise.all([
        q(db.from('v_compras_cerdos_saldo').select('*').eq('id', id).single()),
        q(db.from('pagos_compra_cerdos').select('*').eq('compra_id', id).order('fecha').order('created_at')),
      ]);
      const est = ESTADO[c.estado_pago] || ESTADO.sin_pago;
      const saldo = Number(c.saldo);
      m.setBody(`
        <dl class="detalle">
          <div><dt>Fecha</dt><dd>${fdate(c.fecha)}</dd></div>
          <div><dt>Lote</dt><dd>${esc(nombreLote(c.lote_id))}</dd></div>
          <div><dt>Cerdos</dt><dd>${num(c.cantidad)}</dd></div>
          <div><dt>Valor por cerdo</dt><dd>${money(c.valor_unitario)}</dd></div>
          <div><dt>Total</dt><dd>${money(c.total)}</dd></div>
          <div><dt>Pagado</dt><dd>${money(c.pagado)}</dd></div>
          <div><dt>Saldo</dt><dd class="${saldo > 0 ? 'deuda' : ''}">${money(saldo)}</dd></div>
          <div><dt>Estado</dt><dd><span class="chip ${est.cls}">${est.txt}</span></dd></div>
          ${c.observacion ? `<div style="grid-column:1/-1"><dt>Observación</dt><dd>${esc(c.observacion)}</dd></div>` : ''}
        </dl>

        <h3>Pagos registrados</h3>
        ${pagos.length ? `<div class="tabla-wrap"><table class="tabla">
          <thead><tr><th>Fecha</th><th>Tipo</th><th>Método</th><th class="der">Valor</th><th>Nota</th></tr></thead>
          <tbody>${pagos.map((p) => `<tr>
            <td data-label="Fecha">${fdate(p.fecha)}</td>
            <td data-label="Tipo">${esc(CONCEPTO[p.concepto] || p.concepto)}</td>
            <td data-label="Método">${esc(METODO[p.metodo] || p.metodo)}</td>
            <td data-label="Valor" class="der">${money(p.monto)}</td>
            <td data-label="Nota" class="ancho">${p.observacion ? esc(p.observacion) : ''}</td></tr>`).join('')}</tbody>
        </table></div>` : '<p>Todavía no hay pagos para esta compra.</p>'}

        ${saldo > 0 ? `
        <h3>Registrar abono</h3>
        <form id="f-abono" novalidate>
          <div class="rejilla">
            <div class="campo"><label for="a-fecha">Fecha</label><input id="a-fecha" type="date" value="${today()}" required></div>
            <div class="campo"><label for="a-monto">Valor del abono</label>
              <input id="a-monto" type="text" inputmode="numeric" autocomplete="off" placeholder="$ 0" required>
              <button type="button" class="btn btn-suave" id="a-todo" style="min-height:40px;justify-self:start">Pagar todo el saldo</button></div>
            ${radiosMetodo()}
          </div>
          <div class="campo"><label for="a-nota">Nota (opcional)</label><input id="a-nota" type="text"></div>
          <p class="error" id="a-error" role="alert" hidden></p>
          <div class="acciones-form"><button type="submit" class="btn btn-primario">Guardar abono</button></div>
        </form>` : '<p style="margin-top:1rem"><strong>Esta compra está totalmente pagada.</strong></p>'}
      `);

      const f = m.el.querySelector('#f-abono');
      if (!f) return;
      const monto = f.querySelector('#a-monto'); const err = f.querySelector('#a-error');
      bindMoney(monto);
      f.querySelector('#a-todo').addEventListener('click', () => { setMoney(monto, saldo); monto.focus(); });
      f.addEventListener('submit', async (e) => {
        e.preventDefault();
        err.hidden = true;
        const v = readMoney(monto);
        if (!f.querySelector('#a-fecha').value) return showError(err, 'Elige la fecha del abono.');
        if (v <= 0) return showError(err, 'Escribe el valor del abono.');
        if (v > saldo) return showError(err, `El abono no puede ser mayor que el saldo (${money(saldo)}).`);
        await withBusy(f.querySelector('[type=submit]'), async () => {
          try {
            await q(db.from('pagos_compra_cerdos').insert({
              compra_id: id,
              fecha: f.querySelector('#a-fecha').value,
              concepto: v >= saldo ? 'pago_total' : 'abono',
              monto: v,
              metodo: f.querySelector('input[name=metodo]:checked').value,
              observacion: f.querySelector('#a-nota').value.trim() || null,
            }));
            toast('Abono guardado');
            await pintar();
            cargar();
          } catch (ex) { showError(err, errMsg(ex)); }
        });
      });
    }

    try { await pintar(); }
    catch (e) { m.setBody(errorHtml(e)); }
  }

  /* ---------- Registrar parto ---------- */
  function abrirParto() {
    const cerdas = lotes.filter((l) => l.tipo === 'cerdas');
    const m = modal({
      title: 'Registrar parto',
      html: `<form id="f-parto" novalidate>
        <div class="rejilla">
          <div class="campo"><label for="p-fecha">Fecha del parto</label>
            <input id="p-fecha" type="date" value="${today()}" required></div>
          <div class="campo"><label for="p-origen">Lote de las cerdas</label>
            <select id="p-origen" required>${cerdas.map((l) => `<option value="${l.id}">${esc(l.nombre)}</option>`).join('')}</select></div>
          <div class="campo"><label for="p-destino">Lote al que van los lechones</label>
            <select id="p-destino" required><option value="">Elige el lote</option>
              ${lotes.filter((l) => l.tipo !== 'cerdas').map((l) => `<option value="${l.id}">${esc(l.nombre)}</option>`).join('')}</select></div>
          <div class="campo"><label for="p-cant">Cantidad de lechones</label>
            <input id="p-cant" type="number" inputmode="numeric" min="1" step="1" required></div>
          <div class="campo"><label for="p-valor">Valor por lechón</label>
            <input id="p-valor" type="text" inputmode="numeric" autocomplete="off" placeholder="$ 0" required>
            <span class="ayuda">Lo defines tú. Se suma a la inversión del lote destino y cuenta como ingreso de las cerdas.</span></div>
        </div>
        <p class="total-linea"><span>Valor total del parto</span><strong id="p-total">${money(0)}</strong></p>
        <div class="campo"><label for="p-obs">Observación</label><textarea id="p-obs" rows="2"></textarea></div>
        <p class="error" id="p-error" role="alert" hidden></p>
        <div class="acciones-form">
          <button type="button" class="btn btn-suave" data-cerrar>Cancelar</button>
          <button type="submit" class="btn btn-primario">Guardar parto</button>
        </div>
      </form>`,
    });
    const f = m.el.querySelector('#f-parto');
    const $ = (id) => f.querySelector(id);
    const err = $('#p-error');
    bindMoney($('#p-valor'));
    const total = () => Math.round((Number($('#p-cant').value) || 0) * readMoney($('#p-valor')));
    f.addEventListener('input', () => { $('#p-total').textContent = money(total()); });

    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.hidden = true;
      const cant = Number($('#p-cant').value);
      const valor = readMoney($('#p-valor'));
      if (!$('#p-fecha').value) return showError(err, 'Elige la fecha del parto.');
      if (!$('#p-origen').value) return showError(err, 'No hay un lote de cerdas configurado.');
      if (!$('#p-destino').value) return showError(err, 'Elige el lote al que van los lechones.');
      if (!Number.isInteger(cant) || cant < 1) return showError(err, 'La cantidad de lechones debe ser un número entero mayor que cero.');
      if (valor < 0) return showError(err, 'El valor por lechón no es válido.');
      await withBusy(f.querySelector('[type=submit]'), async () => {
        try {
          await q(db.rpc('registrar_nacimiento', {
            p_fecha: $('#p-fecha').value,
            p_lote_origen_id: Number($('#p-origen').value),
            p_lote_destino: Number($('#p-destino').value),
            p_cantidad: cant,
            p_valor_unitario: valor,
            p_observacion: $('#p-obs').value.trim() || null,
          }));
          m.close();
          toast('Parto guardado');
          cargar();
        } catch (ex) { showError(err, errMsg(ex)); }
      });
    });
  }

  await cargar();
}
