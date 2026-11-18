/* Bajas: cerdos que mueren. Descuenta del lote para que el inventario siempre cuadre. */
import {
  db, q, num, fdate, today, esc, errMsg, toast, modal, errorHtml, loading, withBusy, showError, getLotes, confirmar,
} from '../lib.js';

const CAUSAS = ['Enfermedad', 'Diarrea', 'Aplastamiento', 'Problema respiratorio', 'Accidente', 'Sin causa conocida'];

export async function render({ root }) {
  const st = { filas: [], lote: '', mes: '', lotes: [] };
  let carga = 0;
  root.innerHTML = `
    <header class="page-head">
      <div>
        <h1 tabindex="-1">Bajas</h1>
        <p class="sub">Anota los cerdos que se mueren. Se descuentan del lote y así el inventario siempre cuadra.</p>
      </div>
      <button type="button" class="btn btn-primario" id="btn-nuevo">Nueva baja</button>
    </header>
    <div id="panel"></div>`;
  const panel = root.querySelector('#panel');
  root.querySelector('#btn-nuevo').addEventListener('click', () => abrir());
  panel.addEventListener('click', (e) => {
    if (e.target.closest('[data-reintentar]')) { cargar(); return; }
    const b = e.target.closest('[data-op]');
    if (!b) return;
    const x = st.filas.find((r) => r.id === b.dataset.id);
    if (x) (b.dataset.op === 'editar' ? abrir(x) : borrar(x));
  });
  panel.addEventListener('change', (e) => {
    if (e.target.id === 'f-lote') { st.lote = e.target.value; pintarLista(); }
    if (e.target.id === 'f-mes') { st.mes = e.target.value; pintarLista(); }
  });

  async function cargar() {
    const mi = ++carga;
    panel.innerHTML = loading();
    try {
      const filas = await q(db.from('bajas').select('id,fecha,lote_id,cantidad,causa,observacion').order('fecha', { ascending: false }).order('created_at', { ascending: false }));
      if (mi !== carga) return;
      st.filas = filas; st.lotes = await getLotes();
      pintar();
    } catch (e) { if (mi === carga) panel.innerHTML = errorHtml(e); }
  }
  const nombreLote = (id) => (st.lotes.find((l) => l.id === id) || {}).nombre || `Lote ${id}`;

  function pintar() {
    if (!st.filas.length) {
      panel.innerHTML = `<div class="vacio"><h2>Aún no hay bajas</h2><p>Si se muere un cerdo, anótalo aquí con su lote y la causa.</p></div>`;
      return;
    }
    const meses = [...new Set(st.filas.map((s) => String(s.fecha).slice(0, 7)))].sort().reverse();
    const mesTxt = (ym) => { const [y, m] = ym.split('-'); return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('es-CO', { month: 'long', year: 'numeric' }); };
    panel.innerHTML = `
      <div class="filtros">
        <div class="campo"><label for="f-lote">Lote</label><select id="f-lote"><option value="">Todos</option>
          ${st.lotes.map((l) => `<option value="${l.id}"${st.lote === String(l.id) ? ' selected' : ''}>${esc(l.nombre)}</option>`).join('')}</select></div>
        <div class="campo"><label for="f-mes">Mes</label><select id="f-mes"><option value="">Todo el tiempo</option>
          ${meses.map((ym) => `<option value="${ym}"${st.mes === ym ? ' selected' : ''}>${esc(mesTxt(ym))}</option>`).join('')}</select></div>
      </div>
      <div id="lista"></div>`;
    pintarLista();
  }

  function pintarLista() {
    const cont = panel.querySelector('#lista');
    if (!cont) return;
    const f = st.filas.filter((s) => (!st.lote || String(s.lote_id) === st.lote) && (!st.mes || String(s.fecha).startsWith(st.mes)));
    if (!f.length) { cont.innerHTML = '<div class="vacio"><p>No hay bajas con esos filtros.</p></div>'; return; }
    cont.innerHTML = `
      <div class="tiles"><div class="tile"><strong class="deuda">${num(f.reduce((a, s) => a + Number(s.cantidad), 0))}</strong><span>Cerdos muertos</span></div></div>
      <div class="tabla-wrap"><table class="tabla ancha">
        <thead><tr><th>Fecha</th><th>Lote</th><th class="der">Cerdos</th><th>Causa</th><th></th></tr></thead>
        <tbody>${f.map((s) => `<tr>
          <td data-label="Fecha">${fdate(s.fecha)}</td>
          <td data-label="Lote" class="ancho"><strong>${esc(nombreLote(s.lote_id))}</strong>${s.observacion ? `<span class="obs">${esc(s.observacion)}</span>` : ''}</td>
          <td data-label="Cerdos" class="der">${num(s.cantidad)}</td>
          <td data-label="Causa">${esc(s.causa || '—')}</td>
          <td class="acc"><button type="button" class="btn-texto" data-op="editar" data-id="${esc(s.id)}">Editar</button>
            <button type="button" class="btn-texto peligro" data-op="borrar" data-id="${esc(s.id)}">Eliminar</button></td>
        </tr>`).join('')}</tbody></table></div>`;
  }

  async function abrir(b) {
    const edita = !!b;
    const m = modal({ title: edita ? 'Editar baja' : 'Nueva baja', html: loading() });
    let stock;
    try { stock = await q(db.from('v_stock_cerdos_lote').select('lote_id,nombre,en_lote').order('lote_id')); }
    catch (e) { m.setBody(errorHtml(e)); return; }
    const hay = (lid) => Number((stock.find((x) => x.lote_id === lid) || {}).en_lote || 0) + (edita && b.lote_id === lid ? Number(b.cantidad) : 0);
    const lotes = stock.filter((x) => hay(x.lote_id) > 0 || (edita && x.lote_id === b.lote_id));
    if (!lotes.length) {
      m.setBody(`<div class="vacio"><h2>No hay cerdos en ningún lote</h2><p>Primero registra una compra de cerdos.</p>
        <div class="acciones-form"><button type="button" class="btn btn-suave" data-cerrar>Entendido</button></div></div>`);
      return;
    }
    m.setBody(`<form id="f-baja" novalidate>
      <div class="rejilla">
        <div class="campo"><label for="b-fecha">Fecha</label><input id="b-fecha" type="date" value="${esc(edita ? b.fecha : today())}"></div>
        <div class="campo"><label for="b-lote">Lote</label><select id="b-lote">${lotes.map((x) => `<option value="${x.lote_id}"${edita && b.lote_id === x.lote_id ? ' selected' : ''}>${esc(x.nombre)} · ${hay(x.lote_id)} cerdos</option>`).join('')}</select></div>
        <div class="campo"><label for="b-cant">Cerdos muertos</label><input id="b-cant" type="number" min="1" step="1" inputmode="numeric" value="${esc(edita ? b.cantidad : '1')}"></div>
        <div class="campo"><label for="b-causa">Causa (opcional)</label><input id="b-causa" type="text" list="b-causas" autocomplete="off" value="${esc(edita ? b.causa || '' : '')}">
          <datalist id="b-causas">${CAUSAS.map((c) => `<option value="${esc(c)}"></option>`).join('')}</datalist></div>
      </div>
      <div class="campo"><label for="b-obs">Observación (opcional)</label><textarea id="b-obs" rows="2">${esc(edita ? b.observacion || '' : '')}</textarea></div>
      <p class="error" id="b-error" role="alert" hidden></p>
      <div class="acciones-form"><button type="button" class="btn btn-suave" data-cerrar>Cancelar</button>
        <button type="submit" class="btn btn-primario">${edita ? 'Guardar cambios' : 'Guardar baja'}</button></div>
    </form>`);
    const f = m.el.querySelector('#f-baja'); const $ = (id) => f.querySelector(id); const err = $('#b-error');
    f.addEventListener('submit', async (e) => {
      e.preventDefault(); err.hidden = true;
      const lote = Number($('#b-lote').value); const cant = Number($('#b-cant').value);
      if (!$('#b-fecha').value) return showError(err, 'Elige la fecha.');
      if (!(cant > 0) || !Number.isInteger(cant)) return showError(err, 'Escribe cuántos cerdos murieron.');
      if (cant > hay(lote)) return showError(err, `Ese lote solo tiene ${hay(lote)} cerdos.`);
      const datos = { fecha: $('#b-fecha').value, lote_id: lote, cantidad: cant, causa: $('#b-causa').value.trim() || null, observacion: $('#b-obs').value.trim() || null };
      await withBusy(f.querySelector('[type=submit]'), async () => {
        try {
          if (edita) await q(db.from('bajas').update(datos).eq('id', b.id)); else await q(db.from('bajas').insert(datos));
          m.close(); toast(edita ? 'Cambios guardados' : 'Baja guardada'); await cargar();
        } catch (ex) { showError(err, errMsg(ex)); }
      });
    });
  }

  async function borrar(b) {
    const ok = await confirmar({ titulo: 'Eliminar baja', texto: `Se borra la baja de <strong>${num(b.cantidad)} cerdo(s)</strong> del ${fdate(b.fecha)} y vuelven a contarse en el lote.`, boton: 'Eliminar' });
    if (!ok) return;
    try { await q(db.from('bajas').delete().eq('id', b.id)); toast('Baja eliminada'); await cargar(); }
    catch (ex) { toast(errMsg(ex), 'mal'); }
  }
  cargar();
}
