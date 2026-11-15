/* Inicio: estado general de la granja en una sola vista */
import { db, q, money, num, esc } from '../lib.js';

function saludo() {
  const h = new Date().getHours();
  return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
}

const fila = (etiqueta, valor, extra = '') => `<div><dt>${esc(etiqueta)}</dt><dd class="${extra}">${valor}</dd></div>`;

export async function render({ root, perfil }) {
  const d = await q(db.from('v_dashboard_granja').select('*').single());
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
