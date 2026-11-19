/* Gastos de los lotes: operativos, medicamentos, gasolina, otros y préstamos al operador. */
import {
  db, q, money, fdate, today, esc, errMsg, toast, modal, errorHtml, loading,
  bindMoney, readMoney, setMoney, withBusy, showError, getLotes, confirmar,
} from '../lib.js';

const TIPOS = {
  operativo: 'Operativo',
  medicamento: 'Medicamento',
  gasolina: 'Gasolina',
  prestamo_operador: 'Préstamo al operador',
  otro: 'Otro',
};
const METODO = { efectivo: 'Efectivo', transferencia: 'Transferencia' };

export async function render({ root }) {
  const st = { filas: [], lotes: [], tipo: '', lote: '', mes: '' };
  let carga = 0;
  root.innerHTML = `
    <header class="page-head">
      <div>
        <h1 tabindex="-1">Gastos</h1>
        <p class="sub">Lo que se gasta en cada lote. El préstamo al operador no se carga al lote: se le descuenta en la liquidación. Cada gasto sale de la cuenta que elijas.</p>
      </div>
      <button type="button" class="btn btn-primario" id="btn-nuevo">Nuevo gasto</button>
    </header>
    <div id="panel"></div>`;
  const panel = root.querySelector('#panel');
  root.querySelector('#btn-nuevo').addEventListener('click', () => abrir());
  panel.addEventListener('click', (e) => {
    if (e.target.closest('[data-reintentar]')) { cargar(); return; }
    const b = e.target.closest('[data-op]');
    if (!b) return;
    const g = st.filas.find((x) => x.id === b.dataset.id);
    if (g) (b.dataset.op === 'editar' ? abrir(g) : borrar(g));
  });
  panel.addEventListener('change', (e) => {
    if (e.target.id === 'f-tipo') { st.tipo = e.target.value; pintarLista(); }
    if (e.target.id === 'f-lote') { st.lote = e.target.value; pintarLista(); }
    if (e.target.id === 'f-mes') { st.mes = e.target.value; pintarLista(); }
  });

  async function cargar() {
    const mi = ++carga;
    panel.innerHTML = loading();
    try {
      const [filas, lotes] = await Promise.all([
        q(db.from('gastos').select('id,fecha,tipo,lote_id,valor,metodo,observacion').order('fecha', { ascending: false }).order('created_at', { ascending: false })),
        getLotes(),
      ]);
      if (mi !== carga) return;
      st.filas = filas; st.lotes = lotes;
      pintar();
    } catch (e) { if (mi === carga) panel.innerHTML = errorHtml(e); }
  }
  const nLote = (id) => (id ? (st.lotes.find((l) => l.id === id) || {}).nombre || `Lote ${id}` : 'Sin lote');

  function pintar() {
    if (!st.filas.length) {
      panel.innerHTML = `<div class="vacio"><h2>Aún no hay gastos</h2>
        <p>Anota cada gasto de la granja: el tipo, el lote, el valor y con qué se pagó. Así se calcula lo que realmente dejó cada lote.</p></div>`;
      return;
    }
    const meses = [...new Set(st.filas.map((s) => String(s.fecha).slice(0, 7)))].sort().reverse();
    const mesTxt = (ym) => { const [y, m] = ym.split('-'); return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('es-CO', { month: 'long', year: 'numeric' }); };
    panel.innerHTML = `
      <div class="filtros">
        <div class="campo"><label for="f-tipo">Tipo</label><select id="f-tipo"><option value="">Todos</option>
          ${Object.entries(TIPOS).map(([k, v]) => `<option value="${k}"${st.tipo === k ? ' selected' : ''}>${v}</option>`).join('')}</select></div>
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
    const f = st.filas.filter((g) => (!st.tipo || g.tipo === st.tipo) && (!st.lote || String(g.lote_id) === st.lote) && (!st.mes || String(g.fecha).startsWith(st.mes)));
    if (!f.length) { cont.innerHTML = '<div class="vacio"><p>No hay gastos con esos filtros.</p></div>'; return; }
    const total = f.reduce((a, g) => a + Number(g.valor), 0);
    const porTipo = Object.keys(TIPOS).map((k) => [k, f.filter((g) => g.tipo === k).reduce((a, g) => a + Number(g.valor), 0)]).filter(([, v]) => v > 0);
    cont.innerHTML = `
      <div class="tiles">
        <div class="tile"><strong>${money(total)}</strong><span>Total de gastos</span></div>
        ${porTipo.map(([k, v]) => `<div class="tile"><strong>${money(v)}</strong><span>${TIPOS[k]}</span></div>`).join('')}
      </div>
      <div class="tabla-wrap"><table class="tabla ancha">
        <thead><tr><th>Fecha</th><th>Tipo</th><th>Lote</th><th>Pago</th><th class="der">Valor</th><th></th></tr></thead>
        <tbody>${f.map((g) => `<tr>
          <td data-label="Fecha">${fdate(g.fecha)}</td>
          <td data-label="Tipo" class="ancho"><strong>${esc(TIPOS[g.tipo])}</strong>${g.observacion ? `<span class="obs">${esc(g.observacion)}</span>` : ''}</td>
          <td data-label="Lote">${esc(nLote(g.lote_id))}</td>
          <td data-label="Pago">${g.metodo ? esc(METODO[g.metodo]) : '<span class="obs">Sin cuenta</span>'}</td>
          <td data-label="Valor" class="der">${money(g.valor)}</td>
          <td class="acc"><button type="button" class="btn-texto" data-op="editar" data-id="${esc(g.id)}">Editar</button>
            <button type="button" class="btn-texto peligro" data-op="borrar" data-id="${esc(g.id)}">Eliminar</button></td>
        </tr>`).join('')}</tbody></table></div>`;
  }

  function abrir(g) {
    const edita = !!g;
    const m = modal({
      title: edita ? 'Editar gasto' : 'Nuevo gasto',
      html: `<form id="f-gasto" novalidate>
        <div class="rejilla">
          <div class="campo"><label for="g-fecha">Fecha</label><input id="g-fecha" type="date" value="${esc(edita ? g.fecha : today())}"></div>
          <div class="campo"><label for="g-tipo">Tipo de gasto</label>
            <select id="g-tipo">${Object.entries(TIPOS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
          <div class="campo" id="g-lote-c"><label for="g-lote">Lote</label>
            <select id="g-lote"><option value="">Elige el lote…</option>${st.lotes.map((l) => `<option value="${l.id}">${esc(l.nombre)}</option>`).join('')}</select></div>
          <div class="campo"><label for="g-valor">Valor</label><input id="g-valor" type="text" inputmode="numeric" autocomplete="off" placeholder="$ 0"></div>
        </div>
        <p class="ayuda" id="g-ayuda" hidden>El préstamo al operador no se carga a un lote: se descuenta de su parte en la liquidación. Puedes dejar el lote vacío.</p>
        <fieldset class="segmento campo"><legend>Cómo se pagó</legend>
          <div class="opciones">
            <label><input type="radio" name="g-metodo" value="efectivo"${!edita || g.metodo !== 'transferencia' ? ' checked' : ''}><span>Efectivo</span></label>
            <label><input type="radio" name="g-metodo" value="transferencia"${edita && g.metodo === 'transferencia' ? ' checked' : ''}><span>Transferencia</span></label>
          </div></fieldset>
        <div class="campo"><label for="g-obs">Descripción</label><textarea id="g-obs" rows="2" placeholder="Ej.: vitaminas, gasolina para la moto, arreglo de la cerca">${esc(edita ? g.observacion || '' : '')}</textarea></div>
        <p class="error" id="g-error" role="alert" hidden></p>
        <div class="acciones-form"><button type="button" class="btn btn-suave" data-cerrar>Cancelar</button>
          <button type="submit" class="btn btn-primario">${edita ? 'Guardar cambios' : 'Guardar gasto'}</button></div>
      </form>`,
    });
    const f = m.el.querySelector('#f-gasto'); const $ = (id) => f.querySelector(id); const err = $('#g-error');
    bindMoney($('#g-valor'));
    if (edita) { $('#g-tipo').value = g.tipo; $('#g-lote').value = g.lote_id ?? ''; setMoney($('#g-valor'), Number(g.valor)); }
    const tipoCambia = () => { $('#g-ayuda').hidden = $('#g-tipo').value !== 'prestamo_operador'; };
    $('#g-tipo').addEventListener('change', tipoCambia); tipoCambia();
    f.addEventListener('submit', async (e) => {
      e.preventDefault(); err.hidden = true;
      const tipo = $('#g-tipo').value; const valor = readMoney($('#g-valor')); const lote = $('#g-lote').value;
      if (!$('#g-fecha').value) return showError(err, 'Elige la fecha.');
      if (tipo !== 'prestamo_operador' && !lote) return showError(err, 'Elige el lote al que se carga este gasto.');
      if (!(valor > 0)) return showError(err, 'Escribe el valor del gasto.');
      if (tipo === 'otro' && !$('#g-obs').value.trim()) return showError(err, 'En un gasto “Otro” escribe en la descripción de qué fue.');
      const datos = {
        fecha: $('#g-fecha').value, tipo, lote_id: lote ? Number(lote) : null, valor,
        metodo: f.querySelector('input[name=g-metodo]:checked').value, observacion: $('#g-obs').value.trim() || null,
      };
      await withBusy(f.querySelector('[type=submit]'), async () => {
        try {
          if (edita) await q(db.from('gastos').update(datos).eq('id', g.id)); else await q(db.from('gastos').insert(datos));
          m.close(); toast(edita ? 'Cambios guardados' : 'Gasto guardado'); await cargar();
        } catch (ex) { showError(err, errMsg(ex)); }
      });
    });
  }

  async function borrar(g) {
    const ok = await confirmar({ titulo: 'Eliminar gasto', texto: `Se borra el gasto de <strong>${money(g.valor)}</strong> (${esc(TIPOS[g.tipo])}) del ${fdate(g.fecha)}. Esto no se puede deshacer.`, boton: 'Eliminar' });
    if (!ok) return;
    try { await q(db.from('gastos').delete().eq('id', g.id)); toast('Gasto eliminado'); await cargar(); }
    catch (ex) { toast(errMsg(ex), 'mal'); }
  }
  cargar();
}
