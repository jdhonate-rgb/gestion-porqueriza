/* Liquidación (solo dueño): cierre por lotes, descuentos y parte del operador. */
import {
  db, q, money, num, fdate, today, esc, errMsg, toast, modal, errorHtml, loading,
  bindMoney, readMoney, setMoney, withBusy, showError, getLotes, confirmar,
} from '../lib.js';

const pct = (n) => `${num(n)} %`;

export async function render({ root }) {
  let carga = 0;
  root.innerHTML = `
    <header class="page-head">
      <div>
        <h1 tabindex="-1">Liquidación</h1>
        <p class="sub">Cierre por lotes: de lo que entró por las ventas se restan los costos y los descuentos, y el resto se reparte con el operador.</p>
      </div>
      <button type="button" class="btn btn-primario" id="btn-nueva">Nueva liquidación</button>
    </header>
    <div id="panel"></div>`;
  const panel = root.querySelector('#panel');
  root.querySelector('#btn-nueva').addEventListener('click', nueva);
  panel.addEventListener('click', (e) => {
    if (e.target.closest('[data-reintentar]')) { lista(); return; }
    const b = e.target.closest('[data-abrir]');
    if (b) detalle(b.dataset.abrir);
  });

  /* ---------- Lista ---------- */
  async function lista() {
    const mi = ++carga;
    root.querySelector('#btn-nueva').hidden = false;
    panel.innerHTML = loading();
    try {
      const filas = await q(db.from('v_liquidacion_resumen').select('*').order('desde', { ascending: false }));
      if (mi !== carga) return;
      if (!filas.length) {
        panel.innerHTML = `<div class="vacio"><h2>Aún no hay liquidaciones</h2>
          <p>Crea la primera cuando ya tengas ventas del mes. Eliges el período y los lotes que se liquidan; los descuentos los ajustas antes de cerrar.</p></div>`;
        return;
      }
      panel.innerHTML = `<div class="tabla-wrap"><table class="tabla ancha">
        <thead><tr><th>Período</th><th>Estado</th><th class="der">Ingresos</th><th class="der">A repartir</th><th class="der">Pago neto al operador</th><th></th></tr></thead>
        <tbody>${filas.map((l) => `<tr>
          <td data-label="Período" class="ancho"><strong>${fdate(l.desde)} al ${fdate(l.hasta)}</strong></td>
          <td data-label="Estado"><span class="chip ${l.estado === 'cerrada' ? 'chip-verde' : 'chip-ocre'}">${l.estado === 'cerrada' ? 'Cerrada' : 'Borrador'}</span></td>
          <td data-label="Ingresos" class="der">${money(l.ingresos)}</td>
          <td data-label="A repartir" class="der">${money(l.utilidad_a_repartir)}</td>
          <td data-label="Pago neto al operador" class="der">${money(l.pago_neto_operador)}</td>
          <td class="acc"><button type="button" class="btn-texto" data-abrir="${esc(l.id)}">${l.estado === 'cerrada' ? 'Ver' : 'Continuar'}</button></td>
        </tr>`).join('')}</tbody></table></div>`;
    } catch (e) { if (mi === carga) panel.innerHTML = errorHtml(e); }
  }

  /* ---------- Nueva ---------- */
  async function nueva() {
    let lotes = [];
    try { lotes = (await getLotes()).filter((l) => l.tipo === 'ceba'); } catch (e) { toast(errMsg(e), 'mal'); return; }
    const hoy = today(); const ini = `${hoy.slice(0, 8)}01`;
    const fin = new Date(Number(hoy.slice(0, 4)), Number(hoy.slice(5, 7)), 0).getDate();
    const m = modal({
      title: 'Nueva liquidación',
      html: `<form id="f-liq" novalidate>
        <div class="rejilla">
          <div class="campo"><label for="l-desde">Desde</label><input id="l-desde" type="date" value="${ini}"></div>
          <div class="campo"><label for="l-hasta">Hasta</label><input id="l-hasta" type="date" value="${hoy.slice(0, 8)}${String(fin).padStart(2, '0')}"></div>
          <div class="campo"><label for="l-pct">Parte del operador (%)</label><input id="l-pct" type="number" inputmode="decimal" min="0" max="100" step="0.01" value="50"></div>
        </div>
        <fieldset class="campo"><legend>Lotes que se liquidan</legend>
          <div class="opciones-lotes">${lotes.map((l) => `<label class="check"><input type="checkbox" name="l-lote" value="${l.id}" checked><span>${esc(l.nombre)}</span></label>`).join('')}</div>
          <p class="ayuda">Se cuentan las ventas de cerdos de esos lotes en el período. Un lote que no se haya vendido no entra.</p></fieldset>
        <p class="error" id="l-error" role="alert" hidden></p>
        <div class="acciones-form"><button type="button" class="btn btn-suave" data-cerrar>Cancelar</button>
          <button type="submit" class="btn btn-primario">Calcular liquidación</button></div>
      </form>`,
    });
    const f = m.el.querySelector('#f-liq'); const err = f.querySelector('#l-error');
    f.addEventListener('submit', async (e) => {
      e.preventDefault(); err.hidden = true;
      const desde = f.querySelector('#l-desde').value; const hasta = f.querySelector('#l-hasta').value;
      const p = Number(f.querySelector('#l-pct').value);
      const ids = [...f.querySelectorAll('input[name=l-lote]:checked')].map((x) => Number(x.value));
      if (!desde || !hasta || hasta < desde) return showError(err, 'Elige un período válido: la fecha final no puede ser anterior a la inicial.');
      if (!(p >= 0 && p <= 100)) return showError(err, 'El porcentaje del operador debe estar entre 0 y 100.');
      if (!ids.length) return showError(err, 'Elige al menos un lote.');
      await withBusy(f.querySelector('[type=submit]'), async () => {
        try {
          const id = await q(db.rpc('crear_liquidacion', { p_desde: desde, p_hasta: hasta, p_porcentaje: p, p_lotes: ids }));
          m.close(); toast('Liquidación calculada'); detalle(id);
        } catch (ex) { showError(err, errMsg(ex)); }
      });
    });
  }

  /* ---------- Detalle ---------- */
  async function detalle(id, avisar) {
    const mi = ++carga;
    root.querySelector('#btn-nueva').hidden = true;
    panel.innerHTML = loading();
    try {
      const [res, lotes, desc, nombres] = await Promise.all([
        q(db.from('v_liquidacion_resumen').select('*').eq('id', id)),
        q(db.from('liquidacion_lotes').select('lote_id,cerdos_equivalentes,ingresos,costo_cerdos,costo_alimento,costo_gastos').eq('liquidacion_id', id)),
        q(db.from('liquidacion_descuentos').select('id,tipo,descripcion,saldo_previo,monto').eq('liquidacion_id', id)),
        getLotes(),
      ]);
      if (mi !== carga) return;
      const l = res[0];
      if (!l) { lista(); return; }
      pintarDetalle(l, lotes, desc, nombres);
      if (avisar) toast(avisar);
    } catch (e) { if (mi === carga) panel.innerHTML = errorHtml(e); }
  }

  function pintarDetalle(l, lotes, desc, nombres) {
    const borrador = l.estado === 'borrador';
    const nom = (i) => (nombres.find((x) => x.id === i) || {}).nombre || `Lote ${i}`;
    const filaDesc = (d) => `<tr>
      <td data-label="Concepto" class="ancho">${esc(d.descripcion)}</td>
      <td data-label="Saldo por recuperar" class="der">${money(d.saldo_previo)}</td>
      <td data-label="${borrador ? 'Descontar ahora' : 'Descontado'}" class="der">${borrador
        ? `<input class="monto-desc" type="text" inputmode="numeric" autocomplete="off" aria-label="Descontar de ${esc(d.descripcion)}" data-id="${esc(d.id)}" data-max="${Number(d.saldo_previo)}" placeholder="$ 0">`
        : money(d.monto)}</td></tr>`;
    const tabla = (tipo, titulo, vacio) => {
      const f = desc.filter((d) => d.tipo === tipo);
      return `<h3>${titulo}</h3>${f.length ? `<div class="tabla-wrap"><table class="tabla ancha"><thead><tr><th>Concepto</th><th class="der">Saldo por recuperar</th><th class="der">${borrador ? 'Descontar ahora' : 'Descontado'}</th></tr></thead><tbody>${f.map(filaDesc).join('')}</tbody></table></div>` : `<p class="ayuda">${vacio}</p>`}`;
    };
    panel.innerHTML = `
      <p><button type="button" class="btn-texto" id="volver">← Todas las liquidaciones</button></p>
      <h2 class="liq-titulo">${fdate(l.desde)} al ${fdate(l.hasta)} <span class="chip ${borrador ? 'chip-ocre' : 'chip-verde'}">${borrador ? 'Borrador' : 'Cerrada'}</span></h2>
      <h3>Por lote</h3>
      <div class="tabla-wrap"><table class="tabla ancha">
        <thead><tr><th>Lote</th><th class="der">Cerdos liquidados</th><th class="der">Ingresos</th><th class="der">Costo cerdos</th><th class="der">Alimento</th><th class="der">Gastos</th><th class="der">Utilidad</th></tr></thead>
        <tbody>${lotes.map((x) => `<tr>
          <td data-label="Lote" class="ancho"><strong>${esc(nom(x.lote_id))}</strong></td>
          <td data-label="Cerdos liquidados" class="der">${num(Number(x.cerdos_equivalentes).toFixed(1))}</td>
          <td data-label="Ingresos" class="der">${money(x.ingresos)}</td>
          <td data-label="Costo cerdos" class="der">${money(x.costo_cerdos)}</td>
          <td data-label="Alimento" class="der">${money(x.costo_alimento)}</td>
          <td data-label="Gastos" class="der">${money(x.costo_gastos)}</td>
          <td data-label="Utilidad" class="der"><strong>${money(Number(x.ingresos) - Number(x.costo_cerdos) - Number(x.costo_alimento) - Number(x.costo_gastos))}</strong></td></tr>`).join('')}</tbody></table></div>
      ${tabla('inversion_granja', 'Inversiones de la granja que se recuperan', 'No hay inversiones de la granja pendientes.')}
      ${tabla('prestamo_operador', 'Préstamos al operador que se descuentan', 'No hay préstamos pendientes al operador.')}
      ${borrador ? '<p class="ayuda">Escribe cuánto descontar en cada renglón. No puede pasar del saldo por recuperar.</p>' : ''}
      <h3>Resultado</h3>
      <dl class="resumen-liq" id="resumen">
        <div><dt>Ingresos por ventas</dt><dd>${money(l.ingresos)}</dd></div>
        <div><dt>Costo de los cerdos</dt><dd>− ${money(l.costo_cerdos)}</dd></div>
        <div><dt>Alimento</dt><dd>− ${money(l.costo_alimento)}</dd></div>
        <div><dt>Gastos de los lotes</dt><dd>− ${money(l.costo_gastos)}</dd></div>
        <div class="sub-total"><dt>Utilidad de los lotes</dt><dd>${money(l.utilidad_bruta)}</dd></div>
        <div><dt>Recuperación de inversiones de la granja</dt><dd>− ${money(l.recuperacion_inversion)}</dd></div>
        <div class="sub-total"><dt>Utilidad a repartir</dt><dd>${money(l.utilidad_a_repartir)}</dd></div>
        <div><dt>Parte del operador (${pct(l.porcentaje_operador)})</dt><dd>${money(l.parte_operador)}</dd></div>
        <div><dt>Préstamos descontados</dt><dd>− ${money(l.descuento_prestamos)}</dd></div>
        <div class="gran-total"><dt>Pago neto al operador</dt><dd>${money(l.pago_neto_operador)}</dd></div>
        <div class="gran-total"><dt>Total para el dueño</dt><dd>${money(l.total_dueno)}</dd></div>
      </dl>
      ${borrador ? `<div class="acciones-form">
        <button type="button" class="btn-texto peligro" id="eliminar">Eliminar borrador</button>
        <button type="button" class="btn btn-suave" id="actualizar">Actualizar descuentos</button>
        <button type="button" class="btn btn-primario" id="cerrar">Cerrar liquidación</button></div>` : ''}`;
    panel.querySelector('#volver').addEventListener('click', lista);
    if (!borrador) return;
    panel.querySelectorAll('.monto-desc').forEach((inp) => {
      const d = desc.find((x) => x.id === inp.dataset.id);
      bindMoney(inp); setMoney(inp, Number(d.monto));
      inp.addEventListener('change', async () => {
        let v = readMoney(inp); const max = Number(inp.dataset.max);
        if (v > max) { v = max; toast(`Máximo ${money(max)} en este renglón`, 'mal'); }
        setMoney(inp, v);
        try { await q(db.from('liquidacion_descuentos').update({ monto: v }).eq('id', inp.dataset.id)); await detalle(l.id); }
        catch (ex) { toast(errMsg(ex), 'mal'); }
      });
    });
    panel.querySelector('#actualizar').addEventListener('click', async (e) => {
      await withBusy(e.currentTarget, async () => {
        try { await q(db.rpc('actualizar_descuentos_liquidacion', { p_id: l.id })); await detalle(l.id, 'Descuentos al día'); }
        catch (ex) { toast(errMsg(ex), 'mal'); }
      });
    });
    panel.querySelector('#cerrar').addEventListener('click', async () => {
      const ok = await confirmar({ titulo: 'Cerrar liquidación', texto: `Se cierra con un pago neto de <strong>${money(l.pago_neto_operador)}</strong> para el operador. Después de cerrar ya no se puede cambiar.`, boton: 'Cerrar liquidación' });
      if (!ok) return;
      try { await q(db.rpc('cerrar_liquidacion', { p_id: l.id })); await detalle(l.id, 'Liquidación cerrada'); }
      catch (ex) { toast(errMsg(ex), 'mal'); }
    });
    panel.querySelector('#eliminar').addEventListener('click', async () => {
      const ok = await confirmar({ titulo: 'Eliminar borrador', texto: 'Se borra este cálculo. Podrás hacer otro cuando quieras.', boton: 'Eliminar' });
      if (!ok) return;
      try { await q(db.from('liquidaciones').delete().eq('id', l.id)); toast('Borrador eliminado'); lista(); }
      catch (ex) { toast(errMsg(ex), 'mal'); }
    });
  }
  lista();
}
