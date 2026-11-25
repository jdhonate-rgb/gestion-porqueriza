/* Reportes: rentabilidad por lote, ventas por mes, gastos por mes y cartera. Con descarga a CSV. */
import { db, q, money, num, fdate, esc, errorHtml, loading, toast } from '../lib.js';

const TIPOS = { operativo: 'Operativo', medicamento: 'Medicamento', gasolina: 'Gasolina', prestamo_operador: 'Préstamo al operador', otro: 'Otro' };
const mesTxt = (iso) => { const [y, m] = String(iso).split('-'); return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('es-CO', { month: 'short', year: 'numeric' }); };

function csv(nombre, cols, filas) {
  const cel = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const txt = '﻿' + [cols.map((c) => cel(c.t)).join(';'), ...filas.map((f) => cols.map((c) => cel(c.v(f))).join(';'))].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([txt], { type: 'text/csv;charset=utf-8' }));
  a.download = `${nombre}.csv`; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('Descarga lista');
}

const barra = (v, max, clase = '') => `<span class="barra ${clase}" aria-hidden="true"><i style="width:${max > 0 ? Math.max(0, Math.min(100, (Math.abs(v) / max) * 100)) : 0}%"></i></span>`;

export async function render({ root, perfil }) {
  const esDueno = perfil && perfil.rol === 'dueno';
  const VISTAS = {
    rentabilidad: { t: 'Rentabilidad por lote', f: rentabilidad },
    ventas: { t: 'Ventas por mes', f: ventas },
    gastos: { t: 'Gastos por mes', f: gastos },
    cartera: { t: 'Cartera', f: cartera },
    ...(esDueno ? { auditoria: { t: 'Auditoría', f: auditoria }, respaldo: { t: 'Respaldo', f: respaldo } } : {}),
  };
  let actual = 'rentabilidad'; let carga = 0;
  root.innerHTML = `
    <header class="page-head"><div>
      <h1 tabindex="-1">Reportes</h1>
      <p class="sub">Los números de la granja resumidos. Cada reporte se puede descargar para abrirlo en Excel.</p>
    </div></header>
    <div class="tabs" role="tablist" aria-label="Reportes">
      ${Object.entries(VISTAS).map(([k, v]) => `<button type="button" role="tab" id="tab-${k}" data-tab="${k}" aria-selected="${k === actual}">${v.t}</button>`).join('')}
    </div>
    <div id="panel" role="tabpanel"></div>`;
  const panel = root.querySelector('#panel');
  root.querySelector('.tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]'); if (!b) return;
    actual = b.dataset.tab;
    root.querySelectorAll('[data-tab]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    cargar();
  });
  panel.addEventListener('click', (e) => { if (e.target.closest('[data-reintentar]')) cargar(); });

  async function cargar() {
    const mi = ++carga; panel.innerHTML = loading();
    try { const html = await VISTAS[actual].f(panel); if (mi === carga) { /* ya pintado por la vista */ void html; } }
    catch (e) { if (mi === carga) panel.innerHTML = errorHtml(e); }
  }
  const botonCsv = (id) => `<p class="der"><button type="button" class="btn btn-suave" id="${id}">Descargar CSV</button></p>`;

  async function rentabilidad(p) {
    const f = (await q(db.from('v_rentabilidad_lote').select('*').order('lote_id'))).filter((x) => Number(x.ingresos) || Number(x.costo_total));
    if (!f.length) { p.innerHTML = '<div class="vacio"><p>Todavía no hay compras ni ventas para calcular la rentabilidad.</p></div>'; return; }
    const max = Math.max(...f.map((x) => Math.abs(Number(x.utilidad))));
    const tot = f.filter((x) => x.tipo === 'ceba').reduce((a, x) => ({ i: a.i + Number(x.ingresos), c: a.c + Number(x.costo_total) }), { i: 0, c: 0 });
    p.innerHTML = `
      <div class="tiles"><div class="tile"><strong>${money(tot.i)}</strong><span>Ingresos de ceba</span></div>
        <div class="tile"><strong>${money(tot.c)}</strong><span>Costos de ceba</span></div>
        <div class="tile"><strong class="${tot.i - tot.c < 0 ? 'deuda' : 'ok'}">${money(tot.i - tot.c)}</strong><span>Utilidad de ceba</span></div></div>
      <p class="ayuda">Utilidad = ventas de cerdos sacrificados − compra de cerdos − alimento − gastos del lote. Un lote en curso aún muestra costos de cerdos que no se han vendido. En el lote de cerdas el ingreso es el valor de los nacimientos.</p>
      ${botonCsv('csv')}
      <div class="tabla-wrap"><table class="tabla ancha"><thead><tr><th>Lote</th><th class="der">Ingresos</th><th class="der">Cerdos</th><th class="der">Alimento</th><th class="der">Gastos</th><th class="der">Utilidad</th><th class="der">Margen</th></tr></thead>
      <tbody>${f.map((x) => `<tr><td data-label="Lote" class="ancho"><strong>${esc(x.nombre)}</strong>${barra(Number(x.utilidad), max, Number(x.utilidad) < 0 ? 'neg' : '')}</td>
        <td data-label="Ingresos" class="der">${money(x.ingresos)}</td><td data-label="Cerdos" class="der">${money(x.costo_cerdos)}</td>
        <td data-label="Alimento" class="der">${money(x.costo_alimento)}</td><td data-label="Gastos" class="der">${money(x.costo_gastos)}</td>
        <td data-label="Utilidad" class="der"><strong>${money(x.utilidad)}</strong></td>
        <td data-label="Margen" class="der">${x.margen_pct == null ? '—' : `${num(x.margen_pct)} %`}</td></tr>`).join('')}</tbody></table></div>`;
    p.querySelector('#csv').addEventListener('click', () => csv('rentabilidad-por-lote', [
      { t: 'Lote', v: (x) => x.nombre }, { t: 'Ingresos', v: (x) => x.ingresos }, { t: 'Costo cerdos', v: (x) => x.costo_cerdos },
      { t: 'Costo alimento', v: (x) => x.costo_alimento }, { t: 'Gastos', v: (x) => x.costo_gastos }, { t: 'Utilidad', v: (x) => x.utilidad }, { t: 'Margen %', v: (x) => x.margen_pct }], f));
  }

  async function ventas(p) {
    const [v, r] = await Promise.all([
      q(db.from('v_ventas_mes').select('*').order('mes', { ascending: false })),
      q(db.from('v_recaudo_mes').select('*')),
    ]);
    if (!v.length) { p.innerHTML = '<div class="vacio"><p>Todavía no hay ventas.</p></div>'; return; }
    const rec = new Map(r.map((x) => [String(x.mes), Number(x.recaudado)]));
    const f = v.map((x) => ({ ...x, recaudado: rec.get(String(x.mes)) || 0 }));
    const max = Math.max(...f.map((x) => Number(x.total_vendido)));
    p.innerHTML = `<p class="ayuda">Vendido = lo facturado en el mes (sin la cartera migrada). Recaudado = lo que realmente se cobró en el mes, de ventas de cualquier fecha.</p>${botonCsv('csv')}
      <div class="tabla-wrap"><table class="tabla ancha"><thead><tr><th>Mes</th><th class="der">Ventas</th><th class="der">Kilos</th><th class="der">Vendido</th><th class="der">A crédito</th><th class="der">Recaudado</th></tr></thead>
      <tbody>${f.map((x) => `<tr><td data-label="Mes" class="ancho"><strong>${esc(mesTxt(x.mes))}</strong>${barra(Number(x.total_vendido), max)}</td>
        <td data-label="Ventas" class="der">${num(x.num_ventas)}</td><td data-label="Kilos" class="der">${num(x.kilos)}</td>
        <td data-label="Vendido" class="der"><strong>${money(x.total_vendido)}</strong></td><td data-label="A crédito" class="der">${money(x.total_credito)}</td>
        <td data-label="Recaudado" class="der">${money(x.recaudado)}</td></tr>`).join('')}</tbody></table></div>`;
    p.querySelector('#csv').addEventListener('click', () => csv('ventas-por-mes', [
      { t: 'Mes', v: (x) => String(x.mes).slice(0, 7) }, { t: 'Ventas', v: (x) => x.num_ventas }, { t: 'Kilos', v: (x) => x.kilos },
      { t: 'Vendido', v: (x) => x.total_vendido }, { t: 'A crédito', v: (x) => x.total_credito || 0 }, { t: 'Recaudado', v: (x) => x.recaudado }], f));
  }

  async function gastos(p) {
    const g = await q(db.from('v_gastos_mes').select('*').order('mes', { ascending: false }));
    if (!g.length) { p.innerHTML = '<div class="vacio"><p>Todavía no hay gastos.</p></div>'; return; }
    const meses = [...new Set(g.map((x) => String(x.mes)))];
    const f = meses.map((m) => {
      const o = { mes: m, total: 0 };
      Object.keys(TIPOS).forEach((k) => { o[k] = g.filter((x) => String(x.mes) === m && x.tipo === k).reduce((a, x) => a + Number(x.total), 0); o.total += o[k]; });
      return o;
    });
    const max = Math.max(...f.map((x) => x.total));
    p.innerHTML = `${botonCsv('csv')}<div class="tabla-wrap"><table class="tabla ancha"><thead><tr><th>Mes</th>${Object.values(TIPOS).map((t) => `<th class="der">${t}</th>`).join('')}<th class="der">Total</th></tr></thead>
      <tbody>${f.map((x) => `<tr><td data-label="Mes" class="ancho"><strong>${esc(mesTxt(x.mes))}</strong>${barra(x.total, max)}</td>
        ${Object.entries(TIPOS).map(([k, t]) => `<td data-label="${t}" class="der">${money(x[k])}</td>`).join('')}
        <td data-label="Total" class="der"><strong>${money(x.total)}</strong></td></tr>`).join('')}</tbody></table></div>`;
    p.querySelector('#csv').addEventListener('click', () => csv('gastos-por-mes', [
      { t: 'Mes', v: (x) => x.mes.slice(0, 7) }, ...Object.entries(TIPOS).map(([k, t]) => ({ t, v: (x) => x[k] })), { t: 'Total', v: (x) => x.total }], f));
  }

  async function cartera(p) {
    const c = (await q(db.from('v_cartera_clientes').select('*').order('saldo_total', { ascending: false }))).filter((x) => Number(x.saldo_total) > 0);
    if (!c.length) { p.innerHTML = '<div class="vacio"><h2>Sin cartera pendiente</h2><p>Ningún cliente debe plata en este momento.</p></div>'; return; }
    const tot = c.reduce((a, x) => a + Number(x.saldo_total), 0); const max = Number(c[0].saldo_total);
    p.innerHTML = `<div class="tiles"><div class="tile"><strong class="deuda">${money(tot)}</strong><span>Cartera en la calle</span></div>
      <div class="tile"><strong>${num(c.length)}</strong><span>Clientes con deuda</span></div></div>${botonCsv('csv')}
      <div class="tabla-wrap"><table class="tabla ancha"><thead><tr><th>Cliente</th><th class="der">Ventas pendientes</th><th>Deuda más antigua</th><th class="der">Saldo</th></tr></thead>
      <tbody>${c.map((x) => `<tr><td data-label="Cliente" class="ancho"><strong>${esc(x.nombre)}</strong>${barra(Number(x.saldo_total), max, 'neg')}</td>
        <td data-label="Ventas pendientes" class="der">${num(x.ventas_pendientes)}</td>
        <td data-label="Deuda más antigua">${x.deuda_mas_antigua ? `${fdate(x.deuda_mas_antigua)} (${num(x.dias_deuda_mas_antigua)} días)` : '—'}</td>
        <td data-label="Saldo" class="der"><strong>${money(x.saldo_total)}</strong></td></tr>`).join('')}</tbody></table></div>`;
    p.querySelector('#csv').addEventListener('click', () => csv('cartera-clientes', [
      { t: 'Cliente', v: (x) => x.nombre }, { t: 'Teléfono', v: (x) => x.telefono }, { t: 'Ventas pendientes', v: (x) => x.ventas_pendientes },
      { t: 'Deuda más antigua', v: (x) => x.deuda_mas_antigua }, { t: 'Saldo', v: (x) => x.saldo_total }], c));
  }

  const TABLAS = {
    auditoria: 'Auditoría', perfiles: 'Usuarios', lotes: 'Lotes', clientes: 'Clientes', compras_cerdos: 'Compra de cerdos', pagos_compra_cerdos: 'Pago de compra de cerdos',
    sacrificios: 'Sacrificio', bajas: 'Bajas', ventas: 'Ventas', venta_items: 'Ítem de venta', pagos_venta: 'Cobro / pago de venta',
    compras_alimento: 'Compra de alimento', movimientos_bodega: 'Bodega', gastos: 'Gastos', gastos_granja: 'Inversión de granja',
    cuentas: 'Cuentas', movimientos_cuenta: 'Movimiento de cuenta', liquidaciones: 'Liquidación', liquidacion_lotes: 'Liquidación por lote',
    liquidacion_descuentos: 'Descuento de liquidación',
  };
  const OPER = { INSERT: ['Creó', 'chip-verde'], UPDATE: ['Cambió', 'chip-ocre'], DELETE: ['Eliminó', 'chip-rojo'] };
  const SALTAR = new Set(['id', 'created_at', 'created_by', 'updated_at']);
  const dato = (v) => (v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  const detalleAud = (a) => {
    const base = a.operacion === 'DELETE' ? a.antes : a.despues;
    if (a.operacion === 'UPDATE') {
      const ks = Object.keys(a.despues || {}).filter((k) => !SALTAR.has(k) && dato(a.antes?.[k]) !== dato(a.despues[k]));
      return ks.map((k) => `${esc(k)}: ${esc(dato(a.antes?.[k]))} → ${esc(dato(a.despues[k]))}`).join('<br>') || '—';
    }
    return Object.entries(base || {}).filter(([k, v]) => !SALTAR.has(k) && v !== null).slice(0, 6).map(([k, v]) => `${esc(k)}: ${esc(dato(v))}`).join('<br>');
  };

  async function auditoria(p) {
    const [f, perf] = await Promise.all([
      q(db.from('auditoria').select('id,momento,usuario,tabla,operacion,antes,despues').order('momento', { ascending: false }).limit(200)),
      q(db.from('perfiles').select('id,nombre')),
    ]);
    const nom = new Map(perf.map((x) => [x.id, x.nombre]));
    if (!f.length) { p.innerHTML = '<div class="vacio"><p>Todavía no hay movimientos registrados.</p></div>'; return; }
    p.innerHTML = `<p class="ayuda">Aquí queda anotado quién creó, cambió o eliminó información, y cómo era antes. Nadie puede modificar ni borrar este registro. Se muestran los últimos 200 movimientos.</p>
      <div class="tabla-wrap"><table class="tabla ancha"><thead><tr><th>Fecha y hora</th><th>Quién</th><th>Qué</th><th>Detalle</th></tr></thead>
      <tbody>${f.map((a) => `<tr>
        <td data-label="Fecha y hora">${esc(new Date(a.momento).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }))}</td>
        <td data-label="Quién">${esc(nom.get(a.usuario) || (a.usuario ? 'Usuario' : 'Sistema'))}</td>
        <td data-label="Qué" class="ancho"><span class="chip ${OPER[a.operacion][1]}">${OPER[a.operacion][0]}</span> <strong>${esc(TABLAS[a.tabla] || a.tabla)}</strong></td>
        <td data-label="Detalle" class="obs-aud">${detalleAud(a)}</td></tr>`).join('')}</tbody></table></div>`;
  }

  async function respaldo(p) {
    p.innerHTML = `<p class="ayuda">Descarga una copia de todos los datos de la granja en un solo archivo. Guárdala en un lugar seguro (por ejemplo, tu Google Drive personal) cada semana. Contiene información privada: no la compartas.</p>
      <p><button type="button" class="btn btn-primario" id="bk">Descargar respaldo completo</button></p>
      <p class="ayuda" id="bk-estado" role="status"></p>`;
    p.querySelector('#bk').addEventListener('click', async (e) => {
      const b = e.currentTarget; b.disabled = true; const est = p.querySelector('#bk-estado'); est.textContent = 'Preparando la copia…';
      try {
        const out = { generado: new Date().toISOString(), tablas: {} };
        for (const t of Object.keys(TABLAS).concat(['alimentos', 'proveedores_alimento', 'bodega_stock', 'cobro_visitas', 'cobro_ruta_dia'])) {
          const filas = []; let desde = 0;
          for (;;) {
            const lote = await q(db.from(t).select('*').range(desde, desde + 999));
            filas.push(...lote); if (lote.length < 1000) break; desde += 1000;
          }
          out.tablas[t] = filas;
        }
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' }));
        a.download = `respaldo-granja-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        est.textContent = `Listo. Se guardaron ${Object.values(out.tablas).reduce((n, x) => n + x.length, 0)} registros.`;
      } catch (ex) { est.textContent = `No se pudo: ${ex.message || ex}`; }
      b.disabled = false;
    });
  }
  cargar();
}
