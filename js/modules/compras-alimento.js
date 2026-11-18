/* Compra de alimento: toda compra entra a bodega y se paga completa. */
import {
  db, q, money, num, fdate, today, esc, errMsg, toast, modal, errorHtml, loading,
  bindMoney, readMoney, setMoney, withBusy, showError, confirmar,
} from '../lib.js';

const METODO = { efectivo: 'Efectivo', transferencia: 'Transferencia' };

export async function render({ root }) {
  const st = { filas: [], alimentos: [], proveedores: [], fAli: '', fProv: '', mes: '' };
  let carga = 0;
  root.innerHTML = `
    <header class="page-head">
      <div>
        <h1 tabindex="-1">Compra de alimento</h1>
        <p class="sub">Cada compra suma sus bultos a la bodega y sale de la cuenta (efectivo o Bancolombia) según cómo pagaste.</p>
      </div>
      <button type="button" class="btn btn-primario" id="btn-nueva">Nueva compra</button>
    </header>
    <div id="panel"></div>`;
  const panel = root.querySelector('#panel');
  root.querySelector('#btn-nueva').addEventListener('click', () => abrir());
  panel.addEventListener('click', (e) => {
    if (e.target.closest('[data-reintentar]')) { cargar(); return; }
    const b = e.target.closest('[data-op]');
    if (!b) return;
    const c = st.filas.find((x) => x.id === b.dataset.id);
    if (c) (b.dataset.op === 'editar' ? abrir(c) : borrar(c));
  });
  panel.addEventListener('change', (e) => {
    if (e.target.id === 'f-ali') { st.fAli = e.target.value; pintarLista(); }
    if (e.target.id === 'f-prov') { st.fProv = e.target.value; pintarLista(); }
    if (e.target.id === 'f-mes') { st.mes = e.target.value; pintarLista(); }
  });

  async function cargar() {
    const mi = ++carga;
    panel.innerHTML = loading();
    try {
      const [filas, ali, prov] = await Promise.all([
        q(db.from('compras_alimento').select('id,fecha,alimento_id,proveedor_id,cantidad,valor_unitario,total,metodo_pago,observacion').order('fecha', { ascending: false }).order('created_at', { ascending: false })),
        q(db.from('alimentos').select('id,nombre,unidad').eq('activo', true).order('id')),
        q(db.from('proveedores_alimento').select('id,nombre').eq('activo', true).order('id')),
      ]);
      if (mi !== carga) return;
      st.filas = filas; st.alimentos = ali; st.proveedores = prov;
      pintar();
    } catch (e) { if (mi === carga) panel.innerHTML = errorHtml(e); }
  }
  const nAli = (id) => (st.alimentos.find((x) => x.id === id) || {}).nombre || '—';
  const nProv = (id) => (st.proveedores.find((x) => x.id === id) || {}).nombre || '—';

  function pintar() {
    if (!st.filas.length) {
      panel.innerHTML = `<div class="vacio"><h2>Aún no hay compras de alimento</h2>
        <p>Registra la primera compra: el alimento, el proveedor, los bultos y el valor por bulto. Entra sola a la bodega.</p></div>`;
      return;
    }
    const meses = [...new Set(st.filas.map((s) => String(s.fecha).slice(0, 7)))].sort().reverse();
    const mesTxt = (ym) => { const [y, m] = ym.split('-'); return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('es-CO', { month: 'long', year: 'numeric' }); };
    panel.innerHTML = `
      <div class="filtros">
        <div class="campo"><label for="f-ali">Alimento</label><select id="f-ali"><option value="">Todos</option>
          ${st.alimentos.map((a) => `<option value="${a.id}"${st.fAli === String(a.id) ? ' selected' : ''}>${esc(a.nombre)}</option>`).join('')}</select></div>
        <div class="campo"><label for="f-prov">Proveedor</label><select id="f-prov"><option value="">Todos</option>
          ${st.proveedores.map((a) => `<option value="${a.id}"${st.fProv === String(a.id) ? ' selected' : ''}>${esc(a.nombre)}</option>`).join('')}</select></div>
        <div class="campo"><label for="f-mes">Mes</label><select id="f-mes"><option value="">Todo el tiempo</option>
          ${meses.map((ym) => `<option value="${ym}"${st.mes === ym ? ' selected' : ''}>${esc(mesTxt(ym))}</option>`).join('')}</select></div>
      </div>
      <div id="lista"></div>`;
    pintarLista();
  }

  function pintarLista() {
    const cont = panel.querySelector('#lista');
    if (!cont) return;
    const f = st.filas.filter((c) => (!st.fAli || String(c.alimento_id) === st.fAli) && (!st.fProv || String(c.proveedor_id) === st.fProv)
      && (!st.mes || String(c.fecha).startsWith(st.mes)));
    if (!f.length) { cont.innerHTML = '<div class="vacio"><p>No hay compras con esos filtros.</p></div>'; return; }
    const suma = (k) => f.reduce((a, c) => a + Number(c[k]), 0);
    cont.innerHTML = `
      <div class="tiles">
        <div class="tile"><strong>${money(suma('total'))}</strong><span>Total comprado</span></div>
        <div class="tile"><strong>${num(suma('cantidad'))}</strong><span>Bultos</span></div>
      </div>
      <div class="tabla-wrap"><table class="tabla ancha">
        <thead><tr><th>Fecha</th><th>Alimento</th><th>Proveedor</th><th class="der">Bultos</th><th class="der">Valor bulto</th><th class="der">Total</th><th>Pago</th><th></th></tr></thead>
        <tbody>${f.map((c) => `<tr>
          <td data-label="Fecha">${fdate(c.fecha)}</td>
          <td data-label="Alimento" class="ancho"><strong>${esc(nAli(c.alimento_id))}</strong>${c.observacion ? `<span class="obs">${esc(c.observacion)}</span>` : ''}</td>
          <td data-label="Proveedor">${esc(nProv(c.proveedor_id))}</td>
          <td data-label="Bultos" class="der">${num(c.cantidad)}</td>
          <td data-label="Valor bulto" class="der">${money(c.valor_unitario)}</td>
          <td data-label="Total" class="der">${money(c.total)}</td>
          <td data-label="Pago">${esc(METODO[c.metodo_pago] || c.metodo_pago)}</td>
          <td class="acc"><button type="button" class="btn-texto" data-op="editar" data-id="${esc(c.id)}">Editar</button>
            <button type="button" class="btn-texto peligro" data-op="borrar" data-id="${esc(c.id)}">Eliminar</button></td>
        </tr>`).join('')}</tbody></table></div>`;
  }

  function abrir(c) {
    const edita = !!c;
    const m = modal({
      title: edita ? 'Editar compra de alimento' : 'Nueva compra de alimento',
      html: `<form id="f-compra" novalidate>
        <div class="rejilla">
          <div class="campo"><label for="c-fecha">Fecha</label><input id="c-fecha" type="date" value="${esc(edita ? c.fecha : today())}"></div>
          <div class="campo"><label for="c-ali">Alimento</label><select id="c-ali">${st.alimentos.map((a) => `<option value="${a.id}">${esc(a.nombre)}</option>`).join('')}</select></div>
          <div class="campo"><label for="c-prov">Proveedor</label><select id="c-prov">${st.proveedores.map((a) => `<option value="${a.id}">${esc(a.nombre)}</option>`).join('')}</select></div>
          <div class="campo"><label for="c-cant">Bultos</label><input id="c-cant" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(edita ? c.cantidad : '')}"></div>
          <div class="campo"><label for="c-valor">Valor por bulto</label><input id="c-valor" type="text" inputmode="numeric" autocomplete="off" placeholder="$ 0"></div>
        </div>
        <p class="total-linea">Total de la compra <strong id="c-total">$ 0</strong></p>
        <fieldset class="segmento campo"><legend>Cómo se pagó</legend>
          <div class="opciones">
            <label><input type="radio" name="c-metodo" value="efectivo"${!edita || c.metodo_pago === 'efectivo' ? ' checked' : ''}><span>Efectivo</span></label>
            <label><input type="radio" name="c-metodo" value="transferencia"${edita && c.metodo_pago === 'transferencia' ? ' checked' : ''}><span>Transferencia</span></label>
          </div></fieldset>
        <div class="campo"><label for="c-obs">Observación (opcional)</label><textarea id="c-obs" rows="2">${esc(edita ? c.observacion || '' : '')}</textarea></div>
        <p class="error" id="c-error" role="alert" hidden></p>
        <div class="acciones-form"><button type="button" class="btn btn-suave" data-cerrar>Cancelar</button>
          <button type="submit" class="btn btn-primario">${edita ? 'Guardar cambios' : 'Guardar compra'}</button></div>
      </form>`,
    });
    const f = m.el.querySelector('#f-compra'); const $ = (id) => f.querySelector(id); const err = $('#c-error');
    bindMoney($('#c-valor'));
    if (edita) { $('#c-ali').value = c.alimento_id; $('#c-prov').value = c.proveedor_id; setMoney($('#c-valor'), Number(c.valor_unitario)); }
    const total = () => { $('#c-total').textContent = money(Math.round(Number($('#c-cant').value || 0) * readMoney($('#c-valor')))); };
    f.addEventListener('input', total); total();
    f.addEventListener('submit', async (e) => {
      e.preventDefault(); err.hidden = true;
      const cant = Number($('#c-cant').value); const valor = readMoney($('#c-valor'));
      if (!$('#c-fecha').value) return showError(err, 'Elige la fecha.');
      if (!(cant > 0)) return showError(err, 'Escribe cuántos bultos compraste.');
      if (!(valor > 0)) return showError(err, 'Escribe el valor de cada bulto.');
      const metodo = f.querySelector('input[name=c-metodo]:checked').value;
      const obs = $('#c-obs').value.trim() || null;
      await withBusy(f.querySelector('[type=submit]'), async () => {
        try {
          if (edita) {
            await q(db.rpc('editar_compra_alimento', {
              p_id: c.id, p_fecha: $('#c-fecha').value, p_alimento_id: Number($('#c-ali').value), p_proveedor_id: Number($('#c-prov').value),
              p_cantidad: cant, p_valor_unitario: valor, p_metodo_pago: metodo, p_observacion: obs,
            }));
          } else {
            await q(db.from('compras_alimento').insert({
              fecha: $('#c-fecha').value, alimento_id: Number($('#c-ali').value), proveedor_id: Number($('#c-prov').value),
              cantidad: cant, valor_unitario: valor, metodo_pago: metodo, observacion: obs,
            }));
          }
          m.close(); toast(edita ? 'Cambios guardados' : 'Compra guardada: ya está en bodega'); await cargar();
        } catch (ex) { showError(err, errMsg(ex)); }
      });
    });
  }

  async function borrar(c) {
    const ok = await confirmar({
      titulo: 'Eliminar compra de alimento',
      texto: `Se borra la compra de <strong>${num(c.cantidad)} bultos de ${esc(nAli(c.alimento_id))}</strong> por ${money(c.total)}. También salen de la bodega y de la cuenta. Si ya se gastaron en un lote, no se podrá eliminar.`,
      boton: 'Eliminar',
    });
    if (!ok) return;
    try { await q(db.rpc('eliminar_compra_alimento', { p_id: c.id })); toast('Compra eliminada'); await cargar(); }
    catch (ex) { toast(errMsg(ex), 'mal'); }
  }
  cargar();
}
