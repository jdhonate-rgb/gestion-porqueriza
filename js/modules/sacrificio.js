/* Sacrificio: cerdos sacrificados y peso en canal. Lo que queda en kilos se vende en el módulo Ventas. */
import {
  db, q, num, fdate, today, esc, errMsg, toast, modal, errorHtml, loading, withBusy, showError, getLotes, confirmar,
} from '../lib.js';

export async function render({ root }) {
  const st = { filas: [], lote: '', mes: '' };
  let carga = 0;
  root.innerHTML = `
    <header class="page-head">
      <div>
        <h1 tabindex="-1">Sacrificio</h1>
        <p class="sub">Anota cuántos cerdos se sacrificaron y cuánto pesó la carne (peso en canal). Esos kilos quedan listos para vender.</p>
      </div>
      <button type="button" class="btn btn-primario" id="btn-nuevo">Nuevo sacrificio</button>
    </header>
    <div id="panel"></div>`;
  const panel = root.querySelector('#panel');
  root.querySelector('#btn-nuevo').addEventListener('click', () => abrir());

  panel.addEventListener('click', (e) => {
    if (e.target.closest('[data-reintentar]')) { cargar(); return; }
    const b = e.target.closest('[data-op]');
    if (!b) return;
    const s = st.filas.find((x) => x.id === b.dataset.id);
    if (!s) return;
    if (b.dataset.op === 'editar') abrir(s); else borrar(s);
  });
  panel.addEventListener('change', (e) => {
    if (e.target.id === 'f-lote') { st.lote = e.target.value; pintarLista(); }
    if (e.target.id === 'f-mes') { st.mes = e.target.value; pintarLista(); }
  });

  async function cargar() {
    const mi = ++carga;
    panel.innerHTML = loading();
    try {
      const [sacs, canal] = await Promise.all([
        q(db.from('sacrificios').select('id,fecha,lote_id,cantidad_cerdos,peso_canal_kg,observacion').order('fecha', { ascending: false }).order('created_at', { ascending: false })),
        q(db.from('v_canal_disponible').select('sacrificio_id,kilos_vendidos,kilos_disponibles')),
      ]);
      if (mi !== carga) return;
      st.filas = sacs.map((s) => ({ ...s, ...(canal.find((c) => c.sacrificio_id === s.id) || { kilos_vendidos: 0, kilos_disponibles: s.peso_canal_kg }) }));
      st.lotes = await getLotes();
      pintar();
    } catch (e) { if (mi === carga) panel.innerHTML = errorHtml(e); }
  }
  const nombreLote = (id) => (st.lotes.find((l) => l.id === id) || {}).nombre || `Lote ${id}`;

  function pintar() {
    if (!st.filas.length) {
      panel.innerHTML = `<div class="vacio"><h2>Aún no hay sacrificios</h2>
        <p>Cuando sacrifiques cerdos de un lote, anota la cantidad y el peso de la carne. Así podrás venderla.</p></div>`;
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
    if (!f.length) { cont.innerHTML = '<div class="vacio"><p>No hay sacrificios con esos filtros.</p></div>'; return; }
    const suma = (k) => f.reduce((a, s) => a + Number(s[k]), 0);
    cont.innerHTML = `
      <div class="tiles">
        <div class="tile"><strong>${num(suma('cantidad_cerdos'))}</strong><span>Cerdos sacrificados</span></div>
        <div class="tile"><strong>${num(suma('peso_canal_kg'))} kg</strong><span>Peso en canal</span></div>
        <div class="tile"><strong class="ok">${num(suma('kilos_disponibles'))} kg</strong><span>Por vender</span></div>
      </div>
      <div class="tabla-wrap"><table class="tabla ancha">
        <thead><tr><th>Fecha</th><th>Lote</th><th class="der">Cerdos</th><th class="der">Peso canal</th><th class="der">Kg por cerdo</th><th class="der">Vendido</th><th class="der">Por vender</th><th></th></tr></thead>
        <tbody>${f.map((s) => `<tr>
          <td data-label="Fecha">${fdate(s.fecha)}</td>
          <td data-label="Lote" class="ancho"><strong>${esc(nombreLote(s.lote_id))}</strong>${s.observacion ? `<span class="obs">${esc(s.observacion)}</span>` : ''}</td>
          <td data-label="Cerdos" class="der">${num(s.cantidad_cerdos)}</td>
          <td data-label="Peso canal" class="der">${num(s.peso_canal_kg)} kg</td>
          <td data-label="Kg por cerdo" class="der">${num(Number(s.peso_canal_kg) / Number(s.cantidad_cerdos))}</td>
          <td data-label="Vendido" class="der">${num(s.kilos_vendidos)} kg</td>
          <td data-label="Por vender" class="der">${num(s.kilos_disponibles)} kg</td>
          <td class="acc"><button type="button" class="btn-texto" data-op="editar" data-id="${esc(s.id)}">Editar</button>
            <button type="button" class="btn-texto peligro" data-op="borrar" data-id="${esc(s.id)}">Eliminar</button></td>
        </tr>`).join('')}</tbody></table></div>`;
  }

  async function abrir(s) {
    const edita = !!s;
    const m = modal({ title: edita ? 'Editar sacrificio' : 'Nuevo sacrificio', html: loading() });
    let stock;
    try { stock = await q(db.from('v_stock_cerdos_lote').select('lote_id,nombre,en_lote').order('lote_id')); }
    catch (e) { m.setBody(errorHtml(e)); return; }
    const hay = (lid) => Number((stock.find((x) => x.lote_id === lid) || {}).en_lote || 0) + (edita && s.lote_id === lid ? Number(s.cantidad_cerdos) : 0);
    const lotes = stock.filter((x) => hay(x.lote_id) > 0 || (edita && x.lote_id === s.lote_id));
    if (!lotes.length) {
      m.setBody(`<div class="vacio"><h2>No hay cerdos en ningún lote</h2><p>Primero registra una compra de cerdos.</p>
        <div class="acciones-form"><button type="button" class="btn btn-suave" data-cerrar>Entendido</button></div></div>`);
      return;
    }
    m.setBody(`<form id="f-sac" novalidate>
      <div class="rejilla">
        <div class="campo"><label for="s-fecha">Fecha</label><input id="s-fecha" type="date" value="${esc(edita ? s.fecha : today())}"></div>
        <div class="campo"><label for="s-lote">Lote</label><select id="s-lote">${lotes.map((x) => `<option value="${x.lote_id}"${edita && s.lote_id === x.lote_id ? ' selected' : ''}>${esc(x.nombre)} · ${hay(x.lote_id)} cerdos</option>`).join('')}</select></div>
        <div class="campo"><label for="s-cant">Cerdos sacrificados</label><input id="s-cant" type="number" min="1" step="1" inputmode="numeric" value="${esc(edita ? s.cantidad_cerdos : '')}"></div>
        <div class="campo"><label for="s-peso">Peso en canal (kg)</label><input id="s-peso" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(edita ? s.peso_canal_kg : '')}"></div>
      </div>
      ${edita && Number(s.kilos_vendidos) > 0 ? `<p class="ayuda">Ya se vendieron ${num(s.kilos_vendidos)} kg de este sacrificio: el peso no puede ser menor y no se puede cambiar de lote.</p>` : ''}
      <div class="campo"><label for="s-obs">Observación (opcional)</label><textarea id="s-obs" rows="2">${esc(edita ? s.observacion || '' : '')}</textarea></div>
      <p class="error" id="s-error" role="alert" hidden></p>
      <div class="acciones-form"><button type="button" class="btn btn-suave" data-cerrar>Cancelar</button>
        <button type="submit" class="btn btn-primario">${edita ? 'Guardar cambios' : 'Guardar sacrificio'}</button></div>
    </form>`);
    const f = m.el.querySelector('#f-sac');
    const $ = (id) => f.querySelector(id);
    const err = $('#s-error');
    f.addEventListener('submit', async (e) => {
      e.preventDefault(); err.hidden = true;
      const lote = Number($('#s-lote').value); const cant = Number($('#s-cant').value); const peso = Number($('#s-peso').value);
      if (!$('#s-fecha').value) return showError(err, 'Elige la fecha.');
      if (!(cant > 0) || !Number.isInteger(cant)) return showError(err, 'Escribe cuántos cerdos se sacrificaron.');
      if (cant > hay(lote)) return showError(err, `Ese lote solo tiene ${hay(lote)} cerdos.`);
      if (!(peso > 0)) return showError(err, 'Escribe el peso en canal en kilos.');
      const datos = { fecha: $('#s-fecha').value, lote_id: lote, cantidad_cerdos: cant, peso_canal_kg: peso, observacion: $('#s-obs').value.trim() || null };
      await withBusy(f.querySelector('[type=submit]'), async () => {
        try {
          if (edita) await q(db.from('sacrificios').update(datos).eq('id', s.id)); else await q(db.from('sacrificios').insert(datos));
          m.close(); toast(edita ? 'Cambios guardados' : 'Sacrificio guardado'); await cargar();
        } catch (ex) { showError(err, errMsg(ex)); }
      });
    });
  }

  async function borrar(s) {
    const ok = await confirmar({
      titulo: 'Eliminar sacrificio',
      texto: `Se borra el sacrificio de <strong>${num(s.cantidad_cerdos)} cerdos</strong> (${num(s.peso_canal_kg)} kg) del ${fdate(s.fecha)}. Los cerdos vuelven al lote. Esto no se puede deshacer.`,
      boton: 'Eliminar',
    });
    if (!ok) return;
    try { await q(db.from('sacrificios').delete().eq('id', s.id)); toast('Sacrificio eliminado'); await cargar(); }
    catch (ex) { toast(errMsg(ex), 'mal'); }
  }

  cargar();
}
