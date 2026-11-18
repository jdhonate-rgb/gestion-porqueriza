/* Cuentas: Bancolombia (transferencias) y Efectivo porqueriza (todo lo que se mueve en efectivo) */
import {
  db, q, money, fdate, today, esc, errMsg, toast, modal, errorHtml, loading,
  bindMoney, readMoney, setMoney, withBusy, showError, confirmar,
} from '../lib.js';

const ORIGEN = {
  saldo_inicial: { txt: 'Saldo inicial', cls: 'chip-ocre' },
  manual: { txt: 'Manual', cls: '' },
  traslado: { txt: 'Traslado', cls: '' },
  venta: { txt: 'Automático', cls: '' },
  compra_cerdos: { txt: 'Automático', cls: '' },
  compra_alimento: { txt: 'Automático', cls: '' },
  gasto: { txt: 'Automático', cls: '' },
  gasto_granja: { txt: 'Automático', cls: '' },
};
const origenDe = (m) => (m.tipo === 'saldo_inicial' ? 'saldo_inicial' : m.origen);
const esEditable = (m) => m.origen === 'manual';          // incluye el saldo inicial
const esBorrable = (m) => m.origen === 'manual' || m.origen === 'traslado';

export async function render({ root }) {
  const st = { cuentas: [], saldos: [], movs: [], cuentaId: null, mes: '', tipo: '' };
  let carga = 0;

  root.innerHTML = `
    <header class="page-head">
      <div>
        <h1 tabindex="-1">Cuentas</h1>
        <p class="sub">Bancolombia para las transferencias y Efectivo porqueriza para todo lo que se mueve en efectivo. Los cobros y pagos se reflejan solos; aquí también puedes anotar otros movimientos.</p>
      </div>
      <div class="acciones-cab">
        <button type="button" class="btn btn-suave" id="btn-traslado">Traslado entre cuentas</button>
        <button type="button" class="btn btn-primario" id="btn-mov">Nuevo movimiento</button>
      </div>
    </header>
    <div id="panel"></div>`;
  const panel = root.querySelector('#panel');
  root.querySelector('#btn-mov').addEventListener('click', () => abrirMovimiento());
  root.querySelector('#btn-traslado').addEventListener('click', abrirTraslado);

  panel.addEventListener('click', (e) => {
    if (e.target.closest('[data-reintentar]')) { cargar(); return; }
    const c = e.target.closest('[data-cuenta]');
    if (c) { st.cuentaId = Number(c.dataset.cuenta); st.mes = ''; st.tipo = ''; pintar(); return; }
    const si = e.target.closest('[data-saldo-inicial]');
    if (si) { abrirSaldoInicial(st.cuentas.find((x) => x.id === Number(si.dataset.saldoInicial))); return; }
    const op = e.target.closest('[data-op]');
    if (op) {
      const m = st.movs.find((x) => x.ref_id === op.dataset.id);
      if (!m) return;
      if (op.dataset.op === 'editar') (m.tipo === 'saldo_inicial' ? editarSaldoInicial(m) : abrirMovimiento(m));
      else borrar(m);
    }
  });
  panel.addEventListener('change', (e) => {
    if (e.target.id === 'f-mes') { st.mes = e.target.value; pintarMovs(); }
    if (e.target.id === 'f-tipo') { st.tipo = e.target.value; pintarMovs(); }
  });

  /* ---------- Carga ---------- */
  async function cargar() {
    const mi = ++carga;
    if (!st.cuentas.length) panel.innerHTML = loading();
    try {
      const [cuentas, saldos, movs] = await Promise.all([
        q(db.from('cuentas').select('id,nombre,tipo').eq('activa', true).order('id')),
        q(db.from('v_saldo_cuentas').select('*')),
        q(db.from('v_movimientos_cuenta').select('*').order('fecha', { ascending: false }).order('created_at', { ascending: false }).limit(2000)),
      ]);
      if (mi !== carga) return;
      st.cuentas = cuentas; st.saldos = saldos; st.movs = movs;
      if (!st.cuentas.some((c) => c.id === st.cuentaId)) st.cuentaId = st.cuentas[0]?.id ?? null;
      pintar();
    } catch (e) { if (mi === carga) panel.innerHTML = errorHtml(e); }
  }

  const saldoDe = (id) => st.saldos.find((s) => s.cuenta_id === id);

  function pintar() {
    if (!st.cuentas.length) { panel.innerHTML = '<p class="vacio">No hay cuentas creadas.</p>'; return; }
    const total = st.saldos.reduce((a, s) => a + Number(s.saldo), 0);
    panel.innerHTML = `
      <div class="cuentas-grid">${st.cuentas.map((c) => {
        const s = saldoDe(c.id) || {};
        const activa = c.id === st.cuentaId;
        return `<div class="cuenta-tarjeta${activa ? ' activa' : ''}${c.tipo === 'banco' ? ' banco' : ' efectivo'}">
          <button type="button" class="cuenta-sel" data-cuenta="${c.id}" aria-pressed="${activa}">
            <span class="cuenta-nombre">${esc(c.nombre)}</span>
            <strong class="cuenta-saldo ${Number(s.saldo) < 0 ? 'neg' : ''}">${money(s.saldo)}</strong>
            <span class="cuenta-pie">${s.tiene_saldo_inicial
              ? `<span>Entró ${money(s.ingresos)}</span><span>Salió ${money(s.egresos)}</span>`
              : '<span>Sin saldo inicial</span>'}</span>
          </button>
          ${s.tiene_saldo_inicial ? '' : `<button type="button" class="btn btn-primario btn-sm" data-saldo-inicial="${c.id}">Crear saldo inicial</button>`}
        </div>`;
      }).join('')}</div>
      <p class="total-cuentas">Total en cuentas <strong>${money(total)}</strong></p>
      <div id="detalle"></div>`;
    pintarMovs();
  }

  function pintarMovs() {
    const cont = panel.querySelector('#detalle');
    if (!cont) return;
    const cuenta = st.cuentas.find((c) => c.id === st.cuentaId);
    const s = saldoDe(st.cuentaId) || {};
    let lista = st.movs.filter((m) => m.cuenta_id === st.cuentaId);
    const meses = [...new Set(lista.map((m) => String(m.fecha).slice(0, 7)))];
    if (st.mes && !meses.includes(st.mes)) meses.push(st.mes);
    meses.sort().reverse();
    if (st.mes) lista = lista.filter((m) => String(m.fecha).startsWith(st.mes));
    if (st.tipo) lista = lista.filter((m) => m.tipo === st.tipo);
    const ing = lista.filter((m) => m.tipo === 'ingreso').reduce((a, m) => a + Number(m.monto), 0);
    const egr = lista.filter((m) => m.tipo === 'egreso').reduce((a, m) => a + Number(m.monto), 0);
    const mesTxt = (ym) => { const [y, mm] = ym.split('-'); return new Date(Number(y), Number(mm) - 1, 1).toLocaleDateString('es-CO', { month: 'long', year: 'numeric' }); };

    cont.innerHTML = `
      <h2 class="seccion-cuenta">Movimientos de ${esc(cuenta?.nombre || '')}</h2>
      <div class="filtros">
        <div class="campo"><label for="f-mes">Mes</label>
          <select id="f-mes"><option value="">Todo el tiempo</option>${meses.map((ym) => `<option value="${ym}"${ym === st.mes ? ' selected' : ''}>${esc(mesTxt(ym))}</option>`).join('')}</select></div>
        <div class="campo"><label for="f-tipo">Mostrar</label>
          <select id="f-tipo"><option value="">Entradas y salidas</option>
            <option value="ingreso"${st.tipo === 'ingreso' ? ' selected' : ''}>Solo entradas</option>
            <option value="egreso"${st.tipo === 'egreso' ? ' selected' : ''}>Solo salidas</option></select></div>
      </div>
      <div class="tiles">
        <div class="tile"><strong class="ok">${money(ing)}</strong><span>Entradas${st.mes ? ' del mes' : ''}</span></div>
        <div class="tile"><strong class="deuda">${money(egr)}</strong><span>Salidas${st.mes ? ' del mes' : ''}</span></div>
      </div>
      ${lista.length ? `<div class="tabla-wrap"><table class="tabla ancha">
        <thead><tr><th>Fecha</th><th>Concepto</th><th class="der">Entrada</th><th class="der">Salida</th><th class="der">Saldo</th><th></th></tr></thead>
        <tbody>${lista.map((m) => {
          const o = ORIGEN[origenDe(m)] || ORIGEN.manual;
          return `<tr>
            <td data-label="Fecha">${fdate(m.fecha)}</td>
            <td data-label="Concepto" class="ancho"><strong>${esc(m.concepto)}</strong>
              <span class="chip ${o.cls || 'chip-neutro'}">${o.txt}</span>
              ${m.detalle ? `<span class="obs">${esc(m.detalle)}</span>` : ''}</td>
            <td data-label="Entrada" class="der">${m.tipo === 'egreso' ? '' : `<span class="mov-ing">${money(m.monto)}</span>`}</td>
            <td data-label="Salida" class="der">${m.tipo === 'egreso' ? `<span class="mov-egr">${money(m.monto)}</span>` : ''}</td>
            <td data-label="Saldo" class="der">${money(m.saldo_despues)}</td>
            <td class="acc">${esEditable(m) ? `<button type="button" class="btn-texto" data-op="editar" data-id="${esc(m.ref_id)}">Editar</button>` : ''}
              ${esBorrable(m) ? `<button type="button" class="btn-texto peligro" data-op="borrar" data-id="${esc(m.ref_id)}">Eliminar</button>` : ''}</td>
          </tr>`;
        }).join('')}</tbody></table></div>`
        : `<p class="vacio">${s.tiene_saldo_inicial || st.movs.some((m) => m.cuenta_id === st.cuentaId)
          ? 'No hay movimientos con ese filtro.'
          : 'Esta cuenta aún no tiene movimientos. Empieza creando el saldo inicial.'}</p>`}`;
  }

  /* ---------- Saldo inicial ---------- */
  function abrirSaldoInicial(cuenta) {
    if (!cuenta) return;
    const m = modal({
      title: `Saldo inicial de ${cuenta.nombre}`,
      html: `<form id="f-si" novalidate>
        <p class="ayuda">Es lo que había en la cuenta el día que empiezas a usar la app. Desde esa fecha se suman los cobros, pagos y movimientos.</p>
        <div class="rejilla">
          <div class="campo"><label for="s-monto">Saldo</label><input id="s-monto" type="text" inputmode="numeric" autocomplete="off" placeholder="$ 0" required></div>
          <div class="campo"><label for="s-fecha">A la fecha</label><input id="s-fecha" type="date" value="${today()}" required></div>
        </div>
        <p class="error" id="s-error" role="alert" hidden></p>
        <div class="acciones-form"><button type="button" class="btn btn-suave" data-cerrar>Cancelar</button>
          <button type="submit" class="btn btn-primario">Guardar saldo inicial</button></div>
      </form>`,
    });
    const f = m.el.querySelector('#f-si');
    bindMoney(f.querySelector('#s-monto'));
    const err = f.querySelector('#s-error');
    f.addEventListener('submit', async (e) => {
      e.preventDefault(); err.hidden = true;
      const monto = readMoney(f.querySelector('#s-monto'));
      if (monto <= 0) return showError(err, 'Escribe el saldo con el que empieza la cuenta (mayor que cero).');
      if (!f.querySelector('#s-fecha').value) return showError(err, 'Elige la fecha.');
      await withBusy(f.querySelector('[type=submit]'), async () => {
        try {
          await q(db.from('movimientos_cuenta').insert({
            cuenta_id: cuenta.id, tipo: 'saldo_inicial', monto,
            fecha: f.querySelector('#s-fecha').value, concepto: 'Saldo inicial',
          }));
          m.close(); toast('Saldo inicial guardado'); await cargar();
        } catch (ex) { showError(err, errMsg(ex)); }
      });
    });
  }

  function editarSaldoInicial(mov) {
    const m = modal({
      title: 'Editar saldo inicial',
      html: `<form id="f-si" novalidate>
        <p class="ayuda">Al cambiar la fecha, solo cuentan los cobros y pagos desde ese día.</p>
        <div class="rejilla">
          <div class="campo"><label for="s-monto">Saldo</label><input id="s-monto" type="text" inputmode="numeric" autocomplete="off" required></div>
          <div class="campo"><label for="s-fecha">A la fecha</label><input id="s-fecha" type="date" value="${esc(mov.fecha)}" required></div>
        </div>
        <p class="error" id="s-error" role="alert" hidden></p>
        <div class="acciones-form"><button type="button" class="btn btn-suave" data-cerrar>Cancelar</button>
          <button type="submit" class="btn btn-primario">Guardar cambios</button></div>
      </form>`,
    });
    const f = m.el.querySelector('#f-si');
    bindMoney(f.querySelector('#s-monto')); setMoney(f.querySelector('#s-monto'), Number(mov.monto));
    const err = f.querySelector('#s-error');
    f.addEventListener('submit', async (e) => {
      e.preventDefault(); err.hidden = true;
      const monto = readMoney(f.querySelector('#s-monto'));
      if (monto <= 0) return showError(err, 'Escribe el saldo (mayor que cero).');
      await withBusy(f.querySelector('[type=submit]'), async () => {
        try {
          await q(db.from('movimientos_cuenta').update({ monto, fecha: f.querySelector('#s-fecha').value }).eq('id', mov.ref_id));
          m.close(); toast('Cambios guardados'); await cargar();
        } catch (ex) { showError(err, errMsg(ex)); }
      });
    });
  }

  /* ---------- Movimiento manual (crear / editar) ---------- */
  function abrirMovimiento(mov) {
    const edita = !!mov;
    const m = modal({
      title: edita ? 'Editar movimiento' : 'Nuevo movimiento',
      html: `<form id="f-mov" novalidate>
        <div class="rejilla">
          <div class="campo"><label for="m-cuenta">Cuenta</label>
            <select id="m-cuenta"${edita ? ' disabled' : ''}>${st.cuentas.map((c) => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('')}</select></div>
          <fieldset class="segmento campo"><legend>Tipo</legend>
            <div class="opciones">
              <label><input type="radio" name="m-tipo" value="ingreso"${edita && mov.tipo !== 'ingreso' ? '' : ' checked'}${edita ? ' disabled' : ''}><span>Entrada</span></label>
              <label><input type="radio" name="m-tipo" value="egreso"${edita && mov.tipo === 'egreso' ? ' checked' : ''}${edita ? ' disabled' : ''}><span>Salida</span></label>
            </div></fieldset>
          <div class="campo"><label for="m-monto">Valor</label><input id="m-monto" type="text" inputmode="numeric" autocomplete="off" placeholder="$ 0" required></div>
          <div class="campo"><label for="m-fecha">Fecha</label><input id="m-fecha" type="date" value="${esc(edita ? mov.fecha : today())}" required></div>
        </div>
        <div class="campo"><label for="m-concepto">Concepto</label>
          <input id="m-concepto" type="text" autocomplete="off" value="${esc(edita ? mov.concepto : '')}" placeholder="Ej.: Préstamo recibido, pago de nómina, consignación" required></div>
        <div class="campo"><label for="m-obs">Observación (opcional)</label><textarea id="m-obs" rows="2">${esc(edita ? mov.detalle : '')}</textarea></div>
        <p class="error" id="m-error" role="alert" hidden></p>
        <div class="acciones-form"><button type="button" class="btn btn-suave" data-cerrar>Cancelar</button>
          <button type="submit" class="btn btn-primario">${edita ? 'Guardar cambios' : 'Guardar movimiento'}</button></div>
      </form>`,
    });
    const f = m.el.querySelector('#f-mov');
    const $ = (id) => f.querySelector(id);
    bindMoney($('#m-monto'));
    if (edita) { setMoney($('#m-monto'), Number(mov.monto)); $('#m-cuenta').value = String(mov.cuenta_id); }
    else if (st.cuentaId) $('#m-cuenta').value = String(st.cuentaId);
    const err = $('#m-error');
    f.addEventListener('submit', async (e) => {
      e.preventDefault(); err.hidden = true;
      const monto = readMoney($('#m-monto'));
      if (monto <= 0) return showError(err, 'Escribe el valor del movimiento.');
      if (!$('#m-fecha').value) return showError(err, 'Elige la fecha.');
      if (!$('#m-concepto').value.trim()) return showError(err, 'Escribe el concepto: de qué es este movimiento.');
      const datos = {
        monto, fecha: $('#m-fecha').value, concepto: $('#m-concepto').value.trim(),
        observacion: $('#m-obs').value.trim() || null,
      };
      await withBusy(f.querySelector('[type=submit]'), async () => {
        try {
          if (edita) await q(db.from('movimientos_cuenta').update(datos).eq('id', mov.ref_id));
          else {
            await q(db.from('movimientos_cuenta').insert({
              ...datos, cuenta_id: Number($('#m-cuenta').value),
              tipo: f.querySelector('input[name=m-tipo]:checked').value,
            }));
            st.cuentaId = Number($('#m-cuenta').value);
          }
          m.close(); toast(edita ? 'Cambios guardados' : 'Movimiento guardado'); await cargar();
        } catch (ex) { showError(err, errMsg(ex)); }
      });
    });
  }

  /* ---------- Traslado ---------- */
  function abrirTraslado() {
    if (st.cuentas.length < 2) return toast('Se necesitan dos cuentas para trasladar', 'mal');
    const opts = (sel) => st.cuentas.map((c) => `<option value="${c.id}"${c.id === sel ? ' selected' : ''}>${esc(c.nombre)}</option>`).join('');
    const origen = st.cuentaId ?? st.cuentas[0].id;
    const destino = st.cuentas.find((c) => c.id !== origen).id;
    const m = modal({
      title: 'Traslado entre cuentas',
      html: `<form id="f-tr" novalidate>
        <p class="ayuda">Úsalo cuando sacas plata del banco para tener efectivo, o consignas efectivo en el banco. Sale de una cuenta y entra en la otra.</p>
        <div class="rejilla">
          <div class="campo"><label for="t-origen">Sale de</label><select id="t-origen">${opts(origen)}</select></div>
          <div class="campo"><label for="t-destino">Entra a</label><select id="t-destino">${opts(destino)}</select></div>
          <div class="campo"><label for="t-monto">Valor</label><input id="t-monto" type="text" inputmode="numeric" autocomplete="off" placeholder="$ 0" required></div>
          <div class="campo"><label for="t-fecha">Fecha</label><input id="t-fecha" type="date" value="${today()}" required></div>
        </div>
        <div class="campo"><label for="t-obs">Observación (opcional)</label><input id="t-obs" type="text" autocomplete="off"></div>
        <p class="error" id="t-error" role="alert" hidden></p>
        <div class="acciones-form"><button type="button" class="btn btn-suave" data-cerrar>Cancelar</button>
          <button type="submit" class="btn btn-primario">Hacer traslado</button></div>
      </form>`,
    });
    const f = m.el.querySelector('#f-tr');
    const $ = (id) => f.querySelector(id);
    bindMoney($('#t-monto'));
    const err = $('#t-error');
    f.addEventListener('submit', async (e) => {
      e.preventDefault(); err.hidden = true;
      const monto = readMoney($('#t-monto'));
      if ($('#t-origen').value === $('#t-destino').value) return showError(err, 'Elige dos cuentas distintas.');
      if (monto <= 0) return showError(err, 'Escribe el valor del traslado.');
      if (!$('#t-fecha').value) return showError(err, 'Elige la fecha.');
      await withBusy(f.querySelector('[type=submit]'), async () => {
        try {
          await q(db.rpc('registrar_traslado', {
            p_origen: Number($('#t-origen').value), p_destino: Number($('#t-destino').value),
            p_monto: monto, p_fecha: $('#t-fecha').value, p_observacion: $('#t-obs').value.trim() || null,
          }));
          m.close(); toast('Traslado hecho'); await cargar();
        } catch (ex) { showError(err, errMsg(ex)); }
      });
    });
  }

  /* ---------- Eliminar ---------- */
  async function borrar(mov) {
    const si = mov.tipo === 'saldo_inicial';
    const tr = mov.origen === 'traslado';
    const ok = await confirmar({
      titulo: si ? 'Eliminar saldo inicial' : tr ? 'Eliminar traslado' : 'Eliminar movimiento',
      texto: si
        ? 'Se borra el saldo inicial de esta cuenta. Después tendrás que crearlo de nuevo.'
        : tr
          ? `Se borra el traslado de <strong>${money(mov.monto)}</strong> en las dos cuentas.`
          : `Se borra “${esc(mov.concepto)}” por <strong>${money(mov.monto)}</strong>. Esto no se puede deshacer.`,
    });
    if (!ok) return;
    try {
      await q(db.rpc('eliminar_movimiento_cuenta', { p_id: mov.ref_id }));
      toast('Eliminado'); await cargar();
    } catch (ex) { toast(errMsg(ex), 'mal'); }
  }

  cargar();
}
