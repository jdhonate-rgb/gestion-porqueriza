/* Granja (solo dueño): inversiones que se recuperan poco a poco en cada liquidación. */
import {
  db, q, money, fdate, today, esc, errMsg, toast, modal, errorHtml, loading,
  bindMoney, readMoney, setMoney, withBusy, showError, confirmar,
} from '../lib.js';

const METODO = { efectivo: 'Efectivo', transferencia: 'Transferencia' };

export async function render({ root }) {
  let filas = []; let carga = 0;
  root.innerHTML = `
    <header class="page-head">
      <div>
        <h1 tabindex="-1">Granja</h1>
        <p class="sub">Inversiones de la granja (nevera, báscula, herramientas). Se van recuperando con el descuento que decidas en cada liquidación.</p>
      </div>
      <button type="button" class="btn btn-primario" id="btn-nuevo">Nueva inversión</button>
    </header>
    <div id="panel"></div>`;
  const panel = root.querySelector('#panel');
  root.querySelector('#btn-nuevo').addEventListener('click', () => abrir());
  panel.addEventListener('click', (e) => {
    if (e.target.closest('[data-reintentar]')) { cargar(); return; }
    const b = e.target.closest('[data-op]');
    if (!b) return;
    const g = filas.find((x) => x.id === b.dataset.id);
    if (g) (b.dataset.op === 'editar' ? abrir(g) : borrar(g));
  });

  async function cargar() {
    const mi = ++carga;
    panel.innerHTML = loading();
    try {
      const [inv, sal] = await Promise.all([
        q(db.from('gastos_granja').select('id,fecha,concepto,valor,metodo,observacion').order('fecha', { ascending: false }).order('created_at', { ascending: false })),
        q(db.from('v_saldo_inversiones_granja').select('gasto_granja_id,saldo')),
      ]);
      if (mi !== carga) return;
      const s = new Map(sal.map((x) => [x.gasto_granja_id, Number(x.saldo)]));
      filas = inv.map((g) => ({ ...g, saldo: s.has(g.id) ? s.get(g.id) : Number(g.valor) }));
      pintar();
    } catch (e) { if (mi === carga) panel.innerHTML = errorHtml(e); }
  }

  function pintar() {
    if (!filas.length) {
      panel.innerHTML = `<div class="vacio"><h2>Aún no hay inversiones</h2>
        <p>Anota lo que el dueño invirtió en la granja. En cada liquidación decides cuánto se recupera.</p></div>`;
      return;
    }
    const total = filas.reduce((a, g) => a + Number(g.valor), 0);
    const pend = filas.reduce((a, g) => a + g.saldo, 0);
    panel.innerHTML = `
      <div class="tiles">
        <div class="tile"><strong>${money(total)}</strong><span>Invertido en total</span></div>
        <div class="tile"><strong>${money(total - pend)}</strong><span>Ya recuperado</span></div>
        <div class="tile"><strong class="${pend > 0 ? 'deuda' : 'ok'}">${money(pend)}</strong><span>Por recuperar</span></div>
      </div>
      <div class="tabla-wrap"><table class="tabla ancha">
        <thead><tr><th>Fecha</th><th>Concepto</th><th>Pago</th><th class="der">Valor</th><th class="der">Por recuperar</th><th></th></tr></thead>
        <tbody>${filas.map((g) => `<tr>
          <td data-label="Fecha">${fdate(g.fecha)}</td>
          <td data-label="Concepto" class="ancho"><strong>${esc(g.concepto)}</strong>${g.observacion ? `<span class="obs">${esc(g.observacion)}</span>` : ''}</td>
          <td data-label="Pago">${g.metodo ? esc(METODO[g.metodo]) : '<span class="obs">Sin cuenta</span>'}</td>
          <td data-label="Valor" class="der">${money(g.valor)}</td>
          <td data-label="Por recuperar" class="der">${g.saldo > 0 ? money(g.saldo) : '<span class="chip chip-verde">Recuperada</span>'}</td>
          <td class="acc"><button type="button" class="btn-texto" data-op="editar" data-id="${esc(g.id)}">Editar</button>
            <button type="button" class="btn-texto peligro" data-op="borrar" data-id="${esc(g.id)}">Eliminar</button></td>
        </tr>`).join('')}</tbody></table></div>`;
  }

  function abrir(g) {
    const edita = !!g;
    const m = modal({
      title: edita ? 'Editar inversión' : 'Nueva inversión',
      html: `<form id="f-inv" novalidate>
        <div class="rejilla">
          <div class="campo"><label for="i-fecha">Fecha</label><input id="i-fecha" type="date" value="${esc(edita ? g.fecha : today())}"></div>
          <div class="campo"><label for="i-valor">Valor</label><input id="i-valor" type="text" inputmode="numeric" autocomplete="off" placeholder="$ 0"></div>
        </div>
        <div class="campo"><label for="i-concepto">Qué se compró</label><input id="i-concepto" type="text" maxlength="120" placeholder="Ej.: nevera, báscula, bomba de agua" value="${esc(edita ? g.concepto : '')}"></div>
        <fieldset class="segmento campo"><legend>Cómo se pagó</legend>
          <div class="opciones">
            <label><input type="radio" name="i-metodo" value="efectivo"${!edita || g.metodo !== 'transferencia' ? ' checked' : ''}><span>Efectivo</span></label>
            <label><input type="radio" name="i-metodo" value="transferencia"${edita && g.metodo === 'transferencia' ? ' checked' : ''}><span>Transferencia</span></label>
          </div></fieldset>
        <div class="campo"><label for="i-obs">Nota (opcional)</label><textarea id="i-obs" rows="2">${esc(edita ? g.observacion || '' : '')}</textarea></div>
        <p class="error" id="i-error" role="alert" hidden></p>
        <div class="acciones-form"><button type="button" class="btn btn-suave" data-cerrar>Cancelar</button>
          <button type="submit" class="btn btn-primario">${edita ? 'Guardar cambios' : 'Guardar inversión'}</button></div>
      </form>`,
    });
    const f = m.el.querySelector('#f-inv'); const $ = (id) => f.querySelector(id); const err = $('#i-error');
    bindMoney($('#i-valor')); if (edita) setMoney($('#i-valor'), Number(g.valor));
    f.addEventListener('submit', async (e) => {
      e.preventDefault(); err.hidden = true;
      const valor = readMoney($('#i-valor')); const concepto = $('#i-concepto').value.trim();
      if (!$('#i-fecha').value) return showError(err, 'Elige la fecha.');
      if (!concepto) return showError(err, 'Escribe qué se compró.');
      if (!(valor > 0)) return showError(err, 'Escribe el valor de la inversión.');
      const datos = { fecha: $('#i-fecha').value, concepto, valor, metodo: f.querySelector('input[name=i-metodo]:checked').value, observacion: $('#i-obs').value.trim() || null };
      await withBusy(f.querySelector('[type=submit]'), async () => {
        try {
          if (edita) await q(db.from('gastos_granja').update(datos).eq('id', g.id)); else await q(db.from('gastos_granja').insert(datos));
          m.close(); toast(edita ? 'Cambios guardados' : 'Inversión guardada'); await cargar();
        } catch (ex) { showError(err, errMsg(ex)); }
      });
    });
  }

  async function borrar(g) {
    const ok = await confirmar({ titulo: 'Eliminar inversión', texto: `Se borra <strong>${esc(g.concepto)}</strong> (${money(g.valor)}). Esto no se puede deshacer.`, boton: 'Eliminar' });
    if (!ok) return;
    try { await q(db.from('gastos_granja').delete().eq('id', g.id)); toast('Inversión eliminada'); await cargar(); }
    catch (ex) { toast(errMsg(ex), 'mal'); }
  }
  cargar();
}
