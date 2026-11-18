/* Bodega: existencias de alimento, salidas a cada lote (cargan su costo) y consumo por lote. */
import {
  db, q, money, num, fdate, today, esc, errMsg, toast, modal, errorHtml, loading,
  withBusy, showError, getLotes, confirmar,
} from '../lib.js';

export async function render({ root }) {
  const st = { tab: 'existencias', stock: [], movs: [], consumo: [], lotes: [], alimentos: [], fAli: '', fLote: '', fTipo: '' };
  let carga = 0;
  root.innerHTML = `
    <header class="page-head">
      <div>
        <h1 tabindex="-1">Bodega</h1>
        <p class="sub">Los bultos que compras entran solos. Cuando le das alimento a un lote, anota la salida: su costo se carga a ese lote.</p>
      </div>
      <button type="button" class="btn btn-primario" id="btn-salida">Sacar alimento a un lote</button>
    </header>
    <div class="tabs" role="tablist" aria-label="Bodega">
      <button type="button" role="tab" class="tab" id="tab-existencias" aria-selected="true">Existencias</button>
      <button type="button" role="tab" class="tab" id="tab-movimientos" aria-selected="false">Movimientos</button>
      <button type="button" role="tab" class="tab" id="tab-consumo" aria-selected="false">Consumo por lote</button>
    </div>
    <div id="panel"></div>`;
  const panel = root.querySelector('#panel');
  root.querySelector('#btn-salida').addEventListener('click', () => abrirSalida());
  root.querySelectorAll('[role=tab]').forEach((t) => t.addEventListener('click', () => {
    st.tab = t.id.replace('tab-', '');
    root.querySelectorAll('[role=tab]').forEach((x) => x.setAttribute('aria-selected', String(x === t)));
    pintar();
  }));
  panel.addEventListener('click', (e) => {
    if (e.target.closest('[data-reintentar]')) { cargar(); return; }
    const sac = e.target.closest('[data-sacar]');
    if (sac) { abrirSalida(null, Number(sac.dataset.sacar)); return; }
    const b = e.target.closest('[data-op]');
    if (!b) return;
    const mv = st.movs.find((x) => x.id === b.dataset.id);
    if (mv) (b.dataset.op === 'editar' ? abrirSalida(mv) : borrar(mv));
  });
  panel.addEventListener('change', (e) => {
    if (e.target.id === 'f-ali') { st.fAli = e.target.value; pintar(); }
    if (e.target.id === 'f-lote') { st.fLote = e.target.value; pintar(); }
    if (e.target.id === 'f-tipo') { st.fTipo = e.target.value; pintar(); }
  });

  async function cargar() {
    const mi = ++carga;
    panel.innerHTML = loading();
    try {
      const [stock, movs, consumo, lotes] = await Promise.all([
        q(db.from('v_stock_bodega').select('*').order('alimento_id')),
        q(db.from('movimientos_bodega').select('id,fecha,tipo,alimento_id,cantidad,costo_unitario,costo_total,lote_id,observacion').order('fecha', { ascending: false }).order('created_at', { ascending: false }).limit(1000)),
        q(db.from('v_consumo_alimento_lote').select('*').order('lote_id')),
        getLotes(),
      ]);
      if (mi !== carga) return;
      st.stock = stock; st.movs = movs; st.consumo = consumo; st.lotes = lotes;
      st.alimentos = stock.map((s) => ({ id: s.alimento_id, nombre: s.alimento }));
      pintar();
    } catch (e) { if (mi === carga) panel.innerHTML = errorHtml(e); }
  }
  const nAli = (id) => (st.alimentos.find((x) => x.id === id) || {}).nombre || '—';
  const nLote = (id) => (st.lotes.find((l) => l.id === id) || {}).nombre || (id ? `Lote ${id}` : '—');

  function pintar() {
    if (st.tab === 'existencias') return pintarExistencias();
    if (st.tab === 'movimientos') return pintarMovs();
    return pintarConsumo();
  }

  function pintarExistencias() {
    const valor = st.stock.reduce((a, s) => a + Number(s.valor_inventario), 0);
    panel.innerHTML = `
      <div class="tiles"><div class="tile"><strong>${money(valor)}</strong><span>Valor del alimento en bodega</span></div>
        <div class="tile"><strong>${num(st.stock.reduce((a, s) => a + Number(s.cantidad), 0))}</strong><span>Bultos en total</span></div></div>
      <div class="stock-grid">${st.stock.map((s) => {
        const sin = Number(s.cantidad) <= 0;
        return `<article class="stock-card${sin ? ' sin' : ''}">
          <header><h3>${esc(s.alimento)}</h3>${sin ? '<span class="chip chip-rojo">Sin stock</span>' : ''}</header>
          <p class="stock-n"><strong>${num(s.cantidad)}</strong> ${esc(s.unidad)}s</p>
          <p class="obs">Costo promedio ${money(s.costo_promedio)} por ${esc(s.unidad)} · vale ${money(s.valor_inventario)}</p>
          <button type="button" class="btn btn-suave btn-chico" data-sacar="${s.alimento_id}"${sin ? ' disabled' : ''}>Sacar a un lote</button>
        </article>`;
      }).join('')}</div>`;
  }

  function pintarMovs() {
    if (!st.movs.length) {
      panel.innerHTML = '<div class="vacio"><h2>Todavía no hay movimientos</h2><p>Registra una compra de alimento: entra sola a la bodega.</p></div>';
      return;
    }
    const f = st.movs.filter((m) => (!st.fAli || String(m.alimento_id) === st.fAli) && (!st.fLote || String(m.lote_id) === st.fLote) && (!st.fTipo || m.tipo === st.fTipo));
    panel.innerHTML = `
      <div class="filtros">
        <div class="campo"><label for="f-ali">Alimento</label><select id="f-ali"><option value="">Todos</option>
          ${st.alimentos.map((a) => `<option value="${a.id}"${st.fAli === String(a.id) ? ' selected' : ''}>${esc(a.nombre)}</option>`).join('')}</select></div>
        <div class="campo"><label for="f-lote">Lote</label><select id="f-lote"><option value="">Todos</option>
          ${st.lotes.map((l) => `<option value="${l.id}"${st.fLote === String(l.id) ? ' selected' : ''}>${esc(l.nombre)}</option>`).join('')}</select></div>
        <div class="campo"><label for="f-tipo">Tipo</label><select id="f-tipo"><option value="">Entradas y salidas</option>
          <option value="entrada"${st.fTipo === 'entrada' ? ' selected' : ''}>Solo entradas</option><option value="salida"${st.fTipo === 'salida' ? ' selected' : ''}>Solo salidas</option></select></div>
      </div>
      ${f.length ? `<div class="tabla-wrap"><table class="tabla ancha">
        <thead><tr><th>Fecha</th><th>Movimiento</th><th>Alimento</th><th class="der">Bultos</th><th>Lote</th><th class="der">Costo</th><th></th></tr></thead>
        <tbody>${f.map((m) => `<tr>
          <td data-label="Fecha">${fdate(m.fecha)}</td>
          <td data-label="Movimiento"><span class="chip ${m.tipo === 'entrada' ? 'chip-verde' : 'chip-ocre'}">${m.tipo === 'entrada' ? 'Entrada' : 'Salida'}</span>
            ${m.observacion && m.tipo === 'salida' ? `<span class="obs">${esc(m.observacion)}</span>` : ''}</td>
          <td data-label="Alimento" class="ancho"><strong>${esc(nAli(m.alimento_id))}</strong></td>
          <td data-label="Bultos" class="der">${num(m.cantidad)}</td>
          <td data-label="Lote">${m.tipo === 'salida' ? esc(nLote(m.lote_id)) : '—'}</td>
          <td data-label="Costo" class="der">${money(m.costo_total)}</td>
          <td class="acc">${m.tipo === 'salida' ? `<button type="button" class="btn-texto" data-op="editar" data-id="${esc(m.id)}">Editar</button>
            <button type="button" class="btn-texto peligro" data-op="borrar" data-id="${esc(m.id)}">Eliminar</button>` : '<span class="obs">Desde compra</span>'}</td>
        </tr>`).join('')}</tbody></table></div>` : '<div class="vacio"><p>No hay movimientos con esos filtros.</p></div>'}`;
  }

  function pintarConsumo() {
    if (!st.consumo.length) {
      panel.innerHTML = '<div class="vacio"><h2>Aún no se ha dado alimento a ningún lote</h2><p>Cuando registres una salida de bodega, aquí verás cuánto y cuánto costó por lote.</p></div>';
      return;
    }
    const porLote = new Map();
    st.consumo.forEach((c) => { const a = porLote.get(c.lote_id) || { lote: c.lote, filas: [], costo: 0, cant: 0 }; a.filas.push(c); a.costo += Number(c.costo_total); a.cant += Number(c.cantidad); porLote.set(c.lote_id, a); });
    panel.innerHTML = `
      <div class="tiles"><div class="tile"><strong>${money(st.consumo.reduce((a, c) => a + Number(c.costo_total), 0))}</strong><span>Costo total en alimento</span></div></div>
      ${[...porLote.values()].map((l) => `<section class="bloque-lote"><h3>${esc(l.lote)} <small>${num(l.cant)} bultos · ${money(l.costo)}</small></h3>
        <div class="tabla-wrap"><table class="tabla ancha"><thead><tr><th>Alimento</th><th class="der">Bultos</th><th class="der">Costo</th></tr></thead>
          <tbody>${l.filas.map((c) => `<tr><td data-label="Alimento">${esc(c.alimento)}</td><td data-label="Bultos" class="der">${num(c.cantidad)}</td><td data-label="Costo" class="der">${money(c.costo_total)}</td></tr>`).join('')}</tbody></table></div></section>`).join('')}`;
  }

  /* ---------- Salida a un lote ---------- */
  function abrirSalida(mv, alimentoId) {
    const edita = !!mv;
    const stockDe = (id) => Number((st.stock.find((s) => s.alimento_id === id) || {}).cantidad || 0) + (edita && mv.alimento_id === id ? Number(mv.cantidad) : 0);
    const m = modal({
      title: edita ? 'Editar salida de bodega' : 'Sacar alimento a un lote',
      html: `<form id="f-sal" novalidate>
        <div class="rejilla">
          <div class="campo"><label for="s-fecha">Fecha</label><input id="s-fecha" type="date" value="${esc(edita ? mv.fecha : today())}"></div>
          <div class="campo"><label for="s-lote">Lote que lo recibe</label><select id="s-lote">${st.lotes.map((l) => `<option value="${l.id}">${esc(l.nombre)}</option>`).join('')}</select></div>
          <div class="campo"><label for="s-ali">Alimento</label><select id="s-ali">${st.alimentos.map((a) => `<option value="${a.id}">${esc(a.nombre)}</option>`).join('')}</select></div>
          <div class="campo"><label for="s-cant">Bultos</label><input id="s-cant" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(edita ? mv.cantidad : '')}"></div>
        </div>
        <p class="ayuda" id="s-hay"></p>
        <div class="campo"><label for="s-obs">Observación (opcional)</label><textarea id="s-obs" rows="2">${esc(edita ? mv.observacion || '' : '')}</textarea></div>
        <p class="error" id="s-error" role="alert" hidden></p>
        <div class="acciones-form"><button type="button" class="btn btn-suave" data-cerrar>Cancelar</button>
          <button type="submit" class="btn btn-primario">${edita ? 'Guardar cambios' : 'Guardar salida'}</button></div>
      </form>`,
    });
    const f = m.el.querySelector('#f-sal'); const $ = (id) => f.querySelector(id); const err = $('#s-error');
    if (edita) { $('#s-lote').value = mv.lote_id; $('#s-ali').value = mv.alimento_id; } else if (alimentoId) $('#s-ali').value = alimentoId;
    const hay = () => { $('#s-hay').innerHTML = `En bodega hay <strong>${num(stockDe(Number($('#s-ali').value)))}</strong> bultos de ${esc(nAli(Number($('#s-ali').value)))}${edita ? ' (contando los de esta salida)' : ''}. El costo se calcula con el costo promedio.`; };
    $('#s-ali').addEventListener('change', hay); hay();
    f.addEventListener('submit', async (e) => {
      e.preventDefault(); err.hidden = true;
      const ali = Number($('#s-ali').value); const cant = Number($('#s-cant').value);
      if (!$('#s-fecha').value) return showError(err, 'Elige la fecha.');
      if (!(cant > 0)) return showError(err, 'Escribe cuántos bultos salen.');
      if (cant > stockDe(ali)) return showError(err, `En bodega solo hay ${num(stockDe(ali))} bultos de ${nAli(ali)}.`);
      const obs = $('#s-obs').value.trim() || null;
      await withBusy(f.querySelector('[type=submit]'), async () => {
        try {
          if (edita) {
            await q(db.rpc('editar_salida_bodega', { p_id: mv.id, p_fecha: $('#s-fecha').value, p_alimento_id: ali, p_cantidad: cant, p_lote_id: Number($('#s-lote').value), p_observacion: obs }));
          } else {
            await q(db.from('movimientos_bodega').insert({ fecha: $('#s-fecha').value, tipo: 'salida', alimento_id: ali, cantidad: cant, lote_id: Number($('#s-lote').value), observacion: obs }));
          }
          m.close(); toast(edita ? 'Cambios guardados' : 'Salida guardada'); await cargar();
        } catch (ex) { showError(err, errMsg(ex)); }
      });
    });
  }

  async function borrar(mv) {
    const ok = await confirmar({ titulo: 'Eliminar salida', texto: `Se borra la salida de <strong>${num(mv.cantidad)} bultos de ${esc(nAli(mv.alimento_id))}</strong> a ${esc(nLote(mv.lote_id))}. El alimento vuelve a la bodega y se quita ese costo del lote.`, boton: 'Eliminar' });
    if (!ok) return;
    try { await q(db.rpc('eliminar_salida_bodega', { p_id: mv.id })); toast('Salida eliminada'); await cargar(); }
    catch (ex) { toast(errMsg(ex), 'mal'); }
  }
  cargar();
}
