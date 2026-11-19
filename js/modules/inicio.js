/* Inicio: estado general de la granja en una sola vista */
import { db, q, money, num, esc, today } from '../lib.js';

function saludo() {
  const h = new Date().getHours();
  return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
}

const fila = (etiqueta, valor, extra = '') => `<div><dt>${esc(etiqueta)}</dt><dd class="${extra}">${valor}</dd></div>`;

export async function render({ root, perfil }) {
  const d = await q(db.from('v_dashboard_granja').select('*').single());
  const opc = async (b) => { try { return await q(b); } catch { return null; } };
  const [ruta, cuentas, alertas] = await Promise.all([
    opc(db.from('v_ruta_cobro').select('saldo_total,fecha_pactada')),
    perfil.rol === 'dueno' ? opc(db.from('v_saldo_cuentas').select('nombre,saldo,tiene_saldo_inicial')) : null,
    opc(db.from('v_alerta_stock_alimento').select('alimento,cantidad,unidad,dias_restantes').order('dias_restantes')),
  ]);
  const hoy = today();
  const conFecha = (ruta || []).filter((r) => r.fecha_pactada && Number(r.saldo_total) > 0);
  const venc = conFecha.filter((r) => String(r.fecha_pactada) < hoy);
  const deHoy = conFecha.filter((r) => String(r.fecha_pactada) === hoy);
  const suma = (a) => a.reduce((t, r) => t + Number(r.saldo_total), 0);
  const vacio = Object.values(d).every((v) => Number(v) === 0);
  const nombre = (perfil.nombre || '').split(' ')[0];

  const porRecuperar = perfil.rol === 'dueno' ? `
    <section>
      <h2>Por recuperar</h2>
      <dl>
        ${fila('Inversión de la granja', money(d.inversion_por_recuperar))}
        ${fila('Préstamos pendientes del operador', money(d.prestamos_operador_pendientes))}
      </dl>
    </section>` : '';

  root.innerHTML = `
    <header class="page-head"><div>
      <h1 tabindex="-1">${saludo()}, ${esc(nombre)}</h1>
      <p class="sub">Así está la granja hoy.</p>
    </div></header>

    <section class="inicio-hoy">
      <h2>Para hoy</h2>
      <div class="tiles">
        <a class="tile tile-enlace" href="#/ruta-cobro"><strong class="${deHoy.length ? 'ok' : ''}">${num(deHoy.length)}</strong><span>Cobros para hoy${deHoy.length ? ` · ${money(suma(deHoy))}` : ''}</span></a>
        <a class="tile tile-enlace" href="#/ruta-cobro"><strong class="${venc.length ? 'deuda' : ''}">${num(venc.length)}</strong><span>Cobros atrasados${venc.length ? ` · ${money(suma(venc))}` : ''}</span></a>
      </div>
      ${cuentas && cuentas.length ? `<div class="tiles">${cuentas.map((c) => `<a class="tile tile-enlace" href="#/cuentas"><strong class="${Number(c.saldo) < 0 ? 'deuda' : ''}">${money(c.saldo)}</strong><span>${esc(c.nombre)}</span></a>`).join('')}</div>` : ''}
      ${alertas && alertas.length ? `<p class="aviso-stock"><strong>Se acaba pronto:</strong> ${alertas.map((a) => `${esc(a.alimento)} (${num(a.dias_restantes)} días)`).join(', ')}. <a href="#/alimentos">Comprar alimento</a></p>` : ''}
      <p class="accesos">
        <a class="btn btn-suave" href="#/ventas">Nueva venta</a>
        <a class="btn btn-suave" href="#/gastos">Anotar gasto</a>
        <a class="btn btn-suave" href="#/bodega">Salida de bodega</a>
        <a class="btn btn-suave" href="#/ruta-cobro">Ruta de cobro</a>
      </p>
    </section>

    ${vacio ? `<div class="vacio" style="margin-top:1.5rem">
      <h2>Todavía no hay movimientos</h2>
      <p>Empieza registrando la compra de cerdos de un lote. Puedes dejar un adelanto para apartarlo y abonar después.</p>
      <a class="btn btn-primario" href="#/compras-cerdos">Registrar compra de cerdos</a>
    </div>` : ''}

    <div class="libro">
      <section>
        <h2>Dinero</h2>
        <dl>
          ${fila('Cartera en la calle', money(d.cartera_en_calle), d.cartera_en_calle > 0 ? 'deuda' : '')}
          ${fila('Por pagar de compras de cerdos', money(d.por_pagar_cerdos), d.por_pagar_cerdos > 0 ? 'deuda' : '')}
          ${fila('Ventas del mes', money(d.ventas_mes))}
          ${fila('Recaudo del mes', money(d.recaudo_mes))}
          ${fila('Gastos del mes', money(d.gastos_mes))}
        </dl>
      </section>
      <section>
        <h2>Granja</h2>
        <dl>
          ${fila('Cerdos en la granja', num(d.cerdos_en_granja))}
          ${fila('Alimento en bodega', money(d.valor_bodega))}
        </dl>
      </section>
      ${porRecuperar}
    </div>`;
}
