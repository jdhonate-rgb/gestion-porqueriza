/* Pantalla informativa para los módulos que aún no están construidos */
import { esc } from '../lib.js';

export function render({ root, item }) {
  root.innerHTML = `
    <header class="page-head"><div>
      <h1 tabindex="-1">${esc(item.titulo)}</h1>
      <p class="sub">${esc(item.desc || '')}</p>
    </div></header>
    <div class="vacio" style="margin-top:1.5rem">
      <h2>Este módulo se activa en la siguiente fase</h2>
      <p>La base de datos ya lo tiene listo. Mientras tanto puedes trabajar con Compra de cerdos y Lotes.</p>
      <a class="btn btn-suave" href="#/compras-cerdos">Ir a Compra de cerdos</a>
    </div>`;
}
