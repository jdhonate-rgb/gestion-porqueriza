/* Lotes: cuántos cerdos hay en cada uno y cuánto se ha invertido */
import { db, q, money, num, esc } from '../lib.js';

export async function render({ root }) {
  const [stock, costos] = await Promise.all([
    q(db.from('v_stock_cerdos_lote').select('*').order('lote_id')),
    q(db.from('v_costos_lote').select('*').order('lote_id')),
  ]);
  const costoDe = (id) => {
    const c = costos.find((x) => x.lote_id === id);
    return c ? Number(c.costo_cerdos) + Number(c.costo_alimento) + Number(c.costo_gastos) : 0;
  };

  root.innerHTML = `
    <header class="page-head"><div>
      <h1 tabindex="-1">Lotes</h1>
      <p class="sub">Los cerdos de cada lote y lo invertido hasta hoy en cerdos, alimento y gastos.</p>
    </div></header>
    <div class="lotes">
      ${stock.map((l) => `
        <article class="lote${l.tipo === 'cerdas' ? ' cerdas' : ''}">
          <h2>${esc(l.nombre)}</h2>
          <p class="tipo">${l.tipo === 'cerdas' ? 'Cerdas de cría' : 'Ceba'}</p>
          <p class="cant"><strong>${num(l.en_lote)}</strong><span>${Number(l.en_lote) === 1 ? 'cerdo en el lote' : 'cerdos en el lote'}</span></p>
          <dl>
            <div><dt>Han entrado</dt><dd>${num(l.ingresados)}</dd></div>
            <div><dt>Bajas</dt><dd>${num(l.bajas)}</dd></div>
            <div><dt>Sacrificados</dt><dd>${num(l.sacrificados)}</dd></div>
            <div><dt>Invertido</dt><dd>${money(costoDe(l.lote_id))}</dd></div>
          </dl>
        </article>`).join('')}
    </div>`;
}
