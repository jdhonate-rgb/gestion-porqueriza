const moneda = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
let precioKiloDefecto = 9500;
let datosReporteActual = [];

// 1. AUTENTICACIÓN
document.addEventListener('DOMContentLoaded', async () => {
  const hoy = new Date().toISOString().split('T')[0];
  document.querySelectorAll('input[type="date"]').forEach(i => { if (!i.value) i.value = hoy; });

  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session) iniciarApp(session.user);
});

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) {
    const err = document.getElementById('login-error');
    err.textContent = 'Credenciales inválidas o usuario inactivo.';
    err.classList.remove('hidden');
  } else {
    iniciarApp(data.user);
  }
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  await supabaseClient.auth.signOut();
  location.reload();
});

async function iniciarApp(user) {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app-screen').classList.remove('hidden');

  const { data: perfil } = await supabaseClient.from('usuarios').select('nombre, rol').eq('auth_user_id', user.id).single();
  if (perfil) document.getElementById('user-badge').textContent = `${perfil.nombre} (${perfil.rol})`;

  await cargarTodo();
}

async function cargarTodo() {
  await cargarConfiguracion();
  await Promise.all([
    cargarDashboard(),
    cargarSelectores(),
    cargarVentasYRuta(),
    cargarCuentasBancarias(),
    cargarMovimientosCuenta(),
    cargarVistaReporte()
  ]);
}

// 2. NAVEGACIÓN
function cambiarTab(tabId) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
  document.getElementById(`tab-${tabId}`).classList.remove('hidden');
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('bg-emerald-100', 'text-emerald-800');
    if (btn.dataset.tab === tabId) btn.classList.add('bg-emerald-100', 'text-emerald-800');
  });
}

function cambiarSubTabVentas(sub) {
  document.getElementById('subtab-ruta').classList.toggle('hidden', sub !== 'ruta');
  document.getElementById('subtab-entregas').classList.toggle('hidden', sub !== 'entregas');
  document.getElementById('btn-sub-ruta').className = sub === 'ruta'
    ? 'px-4 py-2 rounded-lg font-semibold bg-amber-600 text-white text-sm'
    : 'px-4 py-2 rounded-lg font-semibold bg-white border text-slate-700 text-sm';
  document.getElementById('btn-sub-entregas').className = sub === 'entregas'
    ? 'px-4 py-2 rounded-lg font-semibold bg-emerald-600 text-white text-sm'
    : 'px-4 py-2 rounded-lg font-semibold bg-white border text-slate-700 text-sm';
}

// 3. CONFIGURACIÓN PRECIO POR DEFECTO
async function cargarConfiguracion() {
  const { data } = await supabaseClient.from('configuracion').select('valor').eq('clave', 'precio_kilo_cerdo_defecto').single();
  if (data) {
    precioKiloDefecto = Number(data.valor);
    document.getElementById('input-precio-defecto').value = precioKiloDefecto;
    document.getElementById('venta-precio-kilo').value = precioKiloDefecto;
  }
}

document.getElementById('form-config-precio').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nuevoValor = document.getElementById('input-precio-defecto').value;
  const { error } = await supabaseClient.from('configuracion').upsert({
    clave: 'precio_kilo_cerdo_defecto',
    valor: String(nuevoValor),
    descripcion: 'Precio por defecto del kilo de cerdo en pie ($)'
  });
  if (error) return alert(error.message);
  precioKiloDefecto = Number(nuevoValor);
  document.getElementById('venta-precio-kilo').value = precioKiloDefecto;
  alert('Precio por defecto actualizado');
});

// 4. SELECTORES GENERALES
async function cargarSelectores() {
  const [{ data: lotes }, { data: clientes }, { data: cuentas }, { data: alimentos }] = await Promise.all([
    supabaseClient.from('lotes').select('id, codigo, nombre').eq('estado', 'ACTIVO'),
    supabaseClient.from('clientes').select('id, nombre, telefono').eq('activo', true).order('nombre'),
    supabaseClient.from('cuentas_bancarias').select('id, nombre, tipo').eq('activa', true),
    supabaseClient.from('catalogo_alimentos').select('id, nombre').eq('activo', true)
  ]);

  const optLotes = '<option value="">Selecciona lote...</option>' + (lotes || []).map(l => `<option value="${l.id}">${l.codigo} - ${l.nombre}</option>`).join('');
  ['select-lote-venta', 'select-lote-despacho'].forEach(id => document.getElementById(id).innerHTML = optLotes);
  document.getElementById('select-lote-gasto').innerHTML = '<option value="">General de la granja</option>' + (lotes || []).map(l => `<option value="${l.id}">${l.codigo} - ${l.nombre}</option>`).join('');

  document.getElementById('select-cliente-venta').innerHTML = '<option value="">Selecciona cliente...</option>' +
    (clientes || []).map(c => `<option value="${c.id}">${c.nombre} (${c.telefono || 'Sin tel'})</option>`).join('');

  const optCuentas = (cuentas || []).map(c => `<option value="${c.id}">${c.nombre} (${c.tipo})</option>`).join('');
  ['select-cuenta-venta', 'select-cuenta-gasto', 'select-cuenta-compra-alim', 'abono-cuenta-id'].forEach(id => {
    document.getElementById(id).innerHTML = optCuentas;
  });
  document.getElementById('filtro-cuenta-mov').innerHTML = '<option value="">Todas las cuentas</option>' + optCuentas;

  const optAlim = '<option value="">Selecciona alimento...</option>' + (alimentos || []).map(a => `<option value="${a.id}">${a.nombre}</option>`).join('');
  ['select-alimento-compra', 'select-alimento-despacho'].forEach(id => document.getElementById(id).innerHTML = optAlim);
}

// 5. DASHBOARD
async function cargarDashboard() {
  const { data: kpi } = await supabaseClient.from('dashboard_gerencial').select('*').single();
  if (kpi) {
    const tarjetas = [
      { t: 'Lotes Activos', v: kpi.lotes_activos },
      { t: 'Cerdos Disponibles', v: kpi.cerdos_disponibles },
      { t: 'Ventas del Mes', v: moneda.format(kpi.ventas_mes) },
      { t: 'Cartera por Cobrar', v: moneda.format(kpi.cartera_pendiente_total) },
      { t: 'Inventario Alimento', v: moneda.format(kpi.valor_inventario_alimento) },
      { t: 'Compras Alimento Mes', v: moneda.format(kpi.compras_alimento_mes) },
      { t: 'Gastos y Medicamentos', v: moneda.format(Number(kpi.otros_gastos_mes) + Number(kpi.costos_sanitarios_mes)) },
      { t: 'Mortalidad Acum.', v: `${kpi.mortalidad_acumulada_porcentaje}%` }
    ];
    document.getElementById('kpi-grid').innerHTML = tarjetas.map(x => `
      <div class="bg-white p-4 rounded-xl shadow-sm border-l-4 border-emerald-600">
        <p class="text-xs text-slate-500 uppercase">${x.t}</p>
        <p class="text-xl font-bold mt-1">${x.v}</p>
      </div>
    `).join('');
  }

  const { data: lotes } = await supabaseClient.from('reporte_produccion_lotes').select('*');
  if (lotes) {
    document.getElementById('tabla-rentabilidad-lotes').innerHTML = lotes.map(l => `
      <tr>
        <td class="p-2 font-medium">${l.codigo} - ${l.nombre}</td>
        <td class="p-2">${l.cantidad_disponible} / ${l.cantidad_inicial}</td>
        <td class="p-2">${l.mortalidad_porcentaje}%</td>
        <td class="p-2">${moneda.format(l.costo_acumulado)}</td>
        <td class="p-2">${moneda.format(l.ventas_registradas)}</td>
        <td class="p-2 font-bold ${l.resultado_bruto_estimado >= 0 ? 'text-emerald-600' : 'text-red-600'}">${moneda.format(l.resultado_bruto_estimado)}</td>
      </tr>
    `).join('');
  }
}

// 6. VENTAS, RUTA DE COBRO Y TARJETA DE CLIENTE
function calcularTotalVenta() {
  const kilos = Number(document.getElementById('venta-kilos').value || 0);
  const precio = Number(document.getElementById('venta-precio-kilo').value || 0);
  document.getElementById('venta-total-preview').textContent = moneda.format(kilos * precio);
}

function toggleCamposCredito() {
  const tipo = document.getElementById('venta-tipo-pago').value;
  document.getElementById('bloque-credito').classList.toggle('hidden', tipo === 'CONTADO');
}

document.getElementById('form-cliente').addEventListener('submit', async (e) => {
  e.preventDefault();
  const datos = Object.fromEntries(new FormData(e.target));
  const { error } = await supabaseClient.from('clientes').insert([datos]);
  if (error) return alert(error.message);
  alert('Cliente creado');
  e.target.reset();
  cargarSelectores();
});

document.getElementById('form-venta').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const datos = Object.fromEntries(fd);
  const totalVenta = Number(datos.kilos) * Number(datos.precio_kilo);
  const abonoInicial = datos.tipo_pago === 'CONTADO' ? totalVenta : Number(datos.abono_inicial || 0);

  const payloadVenta = {
    fecha: datos.fecha,
    lote_id: datos.lote_id,
    cliente_id: datos.cliente_id,
    cantidad_cerdos: Number(datos.cantidad_cerdos),
    kilos: Number(datos.kilos),
    precio_kilo: Number(datos.precio_kilo),
    tipo_pago: datos.tipo_pago,
    cuenta_id: datos.cuenta_id || null,
    numero_cuotas: datos.tipo_pago === 'CONTADO' ? 1 : Number(datos.numero_cuotas || 1),
    fecha_proximo_cobro: datos.fecha_proximo_cobro || null,
    abono_inicial: abonoInicial,
    notas: datos.notas
  };

  const { data: ventaCreada, error } = await supabaseClient.from('ventas').insert([payloadVenta]).select().single();
  if (error) return alert('Error al guardar venta: ' + error.message);

  // Si hubo pago de contado o abono inicial, registrar en abonos y en movimiento bancario
  if (abonoInicial > 0 && datos.cuenta_id) {
    await supabaseClient.from('abonos').insert([{
      fecha: datos.fecha,
      venta_id: ventaCreada.id,
      valor: abonoInicial,
      medio_pago: 'EFECTIVO',
      cuenta_id: datos.cuenta_id,
      notas: datos.tipo_pago === 'CONTADO' ? 'Pago de contado' : 'Abono inicial'
    }]);

    await supabaseClient.from('movimientos_cuenta').insert([{
      fecha: datos.fecha,
      cuenta_id: datos.cuenta_id,
      tipo: 'ENTRADA',
      categoria: 'VENTA',
      concepto: `Ingreso venta cerdos (${datos.cantidad_cerdos} und - ${datos.kilos} kg)`,
      valor: abonoInicial,
      referencia_id: ventaCreada.id
    }]);
  }

  alert('Venta registrada exitosamente');
  e.target.reset();
  document.getElementById('venta-precio-kilo').value = precioKiloDefecto;
  cambiarSubTabVentas('ruta');
  cargarTodo();
});

async function cargarVentasYRuta() {
  const { data: ventas } = await supabaseClient.from('reporte_ventas_cartera').select('*').order('fecha', { ascending: false });
  if (!ventas) return;

  const deudores = ventas.filter(v => Number(v.saldo) > 0);
  const sumaDeuda = deudores.reduce((acc, v) => acc + Number(v.saldo), 0);
  document.getElementById('total-ruta-cobro').textContent = `Total por cobrar: ${moneda.format(sumaDeuda)}`;

  document.getElementById('tabla-ruta-cobro').innerHTML = deudores.map(v => `
    <tr>
      <td class="p-2"><strong>${v.cliente || 'Cliente'}</strong><br><span class="text-xs text-slate-500">${v.cliente_telefono || ''}</span></td>
      <td class="p-2 text-xs">${v.cliente_direccion || 'Sin dirección'}</td>
      <td class="p-2">${v.fecha}</td>
      <td class="p-2 font-semibold">${v.numero_cuotas} cuotas</td>
      <td class="p-2 text-amber-700 font-medium">${v.fecha_proximo_cobro || 'Pendiente'}</td>
      <td class="p-2">${moneda.format(v.total)}</td>
      <td class="p-2 font-bold text-red-600">${moneda.format(v.saldo)}</td>
      <td class="p-2">
        <button onclick='abrirTarjetaCliente(${JSON.stringify(v)})' class="bg-amber-600 text-white px-2.5 py-1 rounded text-xs font-semibold hover:bg-amber-700">
          Tarjeta / Cobrar
        </button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="8" class="p-4 text-center text-slate-400">No hay deudores pendientes en ruta</td></tr>';

  document.getElementById('tabla-ventas-historial').innerHTML = ventas.map(v => `
    <tr>
      <td class="p-2">${v.fecha}</td>
      <td class="p-2 font-medium">${v.cliente || 'General'}</td>
      <td class="p-2">${v.lote_codigo}</td>
      <td class="p-2">${v.cantidad_cerdos} cerdos (${v.kilos} kg)</td>
      <td class="p-2 text-xs">${v.tipo_pago} (${v.numero_cuotas}c)</td>
      <td class="p-2 font-semibold">${moneda.format(v.total)}</td>
      <td class="p-2 ${v.saldo > 0 ? 'text-red-600 font-bold' : 'text-emerald-600'}">${moneda.format(v.saldo)}</td>
      <td class="p-2"><button onclick='abrirTarjetaCliente(${JSON.stringify(v)})' class="text-blue-600 underline text-xs">Ver Tarjeta</button></td>
    </tr>
  `).join('');
}

async function abrirTarjetaCliente(v) {
  document.getElementById('modal-cliente').classList.remove('hidden');
  document.getElementById('modal-cliente-titulo').textContent = `Tarjeta: ${v.cliente || 'Cliente'}`;
  document.getElementById('abono-venta-id').value = v.id;

  const { data: abonos } = await supabaseClient.from('abonos').select('*').eq('venta_id', v.id).order('fecha');
  const listaAbonos = (abonos || []).map(a => `<li>• ${a.fecha}: <strong>${moneda.format(a.valor)}</strong> (${a.medio_pago})</li>`).join('') || '<li>Sin abonos registrados aún</li>';

  document.getElementById('modal-cliente-detalle').innerHTML = `
    <p><strong>Fecha de Venta:</strong> ${v.fecha} | <strong>Lote:</strong> ${v.lote_codigo}</p>
    <p><strong>Modalidad:</strong> ${v.tipo_pago} pactado a <strong>${v.numero_cuotas} cuota(s)</strong></p>
    <p><strong>Total Venta:</strong> ${moneda.format(v.total)} | <strong>Abonado:</strong> ${moneda.format(v.abonado)} | <strong class="text-red-600">Saldo: ${moneda.format(v.saldo)}</strong></p>
    <div class="mt-2 pt-2 border-t">
      <p class="font-semibold text-xs uppercase text-slate-500">Historial de Abonos:</p>
      <ul class="text-xs space-y-1 mt-1">${listaAbonos}</ul>
    </div>
  `;
}

function cerrarModalCliente() {
  document.getElementById('modal-cliente').classList.add('hidden');
}

document.getElementById('form-abono-venta').addEventListener('submit', async (e) => {
  e.preventDefault();
  const venta_id = document.getElementById('abono-venta-id').value;
  const fecha = document.getElementById('abono-fecha').value;
  const valor = Number(document.getElementById('abono-valor').value);
  const medio_pago = document.getElementById('abono-medio').value;
  const cuenta_id = document.getElementById('abono-cuenta-id').value;

  const { error } = await supabaseClient.from('abonos').insert([{ venta_id, fecha, valor, medio_pago, cuenta_id }]);
  if (error) return alert(error.message);

  await supabaseClient.from('movimientos_cuenta').insert([{
    fecha, cuenta_id, tipo: 'ENTRADA', categoria: 'ABONO',
    concepto: `Abono cobro cartera (${medio_pago})`, valor, referencia_id: venta_id
  }]);

  alert('Abono registrado y sumado a la cuenta');
  cerrarModalCliente();
  cargarTodo();
});

// 7. BANCOS Y FLUJO DE MOVIMIENTOS
document.getElementById('form-cuenta').addEventListener('submit', async (e) => {
  e.preventDefault();
  const datos = Object.fromEntries(new FormData(e.target));
  const { error } = await supabaseClient.from('cuentas_bancarias').insert([datos]);
  if (error) return alert(error.message);
  alert('Cuenta bancaria / caja creada');
  e.target.reset();
  cargarTodo();
});

async function cargarCuentasBancarias() {
  const { data } = await supabaseClient.from('resumen_cuentas_bancarias').select('*');
  if (data) {
    document.getElementById('cards-cuentas-bancarias').innerHTML = data.map(c => `
      <div class="bg-white p-4 rounded-xl shadow-sm border-t-4 border-blue-600">
        <div class="flex justify-between text-xs text-slate-500">
          <span>${c.tipo}</span>
          <span>${c.numero_cuenta || ''}</span>
        </div>
        <h4 class="font-bold text-lg mt-1">${c.nombre}</h4>
        <p class="text-2xl font-bold text-blue-900 my-2">${moneda.format(c.saldo_actual)}</p>
        <div class="text-xs flex justify-between text-slate-500 border-t pt-2">
          <span>Inicial: ${moneda.format(c.saldo_inicial)}</span>
          <span class="text-emerald-600">+${moneda.format(c.total_entradas)}</span>
          <span class="text-red-600">-${moneda.format(c.total_salidas)}</span>
        </div>
      </div>
    `).join('');
  }
}

async function cargarMovimientosCuenta() {
  const cuentaId = document.getElementById('filtro-cuenta-mov').value;
  const desde = document.getElementById('filtro-desde-mov').value;
  const hasta = document.getElementById('filtro-hasta-mov').value;

  let query = supabaseClient.from('movimientos_cuenta').select('*, cuentas_bancarias(nombre)').order('fecha', { ascending: false });
  if (cuentaId) query = query.eq('cuenta_id', cuentaId);
  if (desde) query = query.gte('fecha', desde);
  if (hasta) query = query.lte('fecha', hasta);

  const { data } = await query;
  if (!data) return;

  let entradas = 0, salidas = 0;
  document.getElementById('tabla-movimientos-cuenta').innerHTML = data.map(m => {
    if (m.tipo === 'ENTRADA') entradas += Number(m.valor);
    else salidas += Number(m.valor);
    return `
      <tr>
        <td class="p-2">${m.fecha}</td>
        <td class="p-2 font-medium">${m.cuentas_bancarias?.nombre || ''}</td>
        <td class="p-2"><span class="px-2 py-0.5 rounded text-xs ${m.tipo === 'ENTRADA' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}">${m.tipo}</span></td>
        <td class="p-2">${m.concepto}</td>
        <td class="p-2 font-bold ${m.tipo === 'ENTRADA' ? 'text-emerald-700' : 'text-red-700'}">${moneda.format(m.valor)}</td>
      </tr>
    `;
  }).join('') || '<tr><td colspan="5" class="p-4 text-center text-slate-400">Sin movimientos en este rango de fechas</td></tr>';

  document.getElementById('mov-total-entradas').textContent = moneda.format(entradas);
  document.getElementById('mov-total-salidas').textContent = moneda.format(salidas);
  document.getElementById('mov-balance-periodo').textContent = moneda.format(entradas - salidas);
}

// 8. COMPRAS DE MEDICAMENTOS, ALIMENTOS Y LOTES
document.getElementById('form-gasto-med').addEventListener('submit', async (e) => {
  e.preventDefault();
  const datos = Object.fromEntries(new FormData(e.target));
  if (!datos.lote_id) delete datos.lote_id;

  const { data: gasto, error } = await supabaseClient.from('otros_gastos').insert([datos]).select().single();
  if (error) return alert(error.message);

  if (datos.metodo_pago !== 'CREDITO' && datos.cuenta_id) {
    await supabaseClient.from('movimientos_cuenta').insert([{
      fecha: datos.fecha, cuenta_id: datos.cuenta_id, tipo: 'SALIDA',
      categoria: datos.categoria, concepto: `${datos.categoria}: ${datos.concepto}`,
      valor: Number(datos.valor), referencia_id: gasto.id
    }]);
  }
  alert('Compra / Gasto registrado');
  e.target.reset();
  cargarTodo();
});

document.getElementById('form-compra-alimento').addEventListener('submit', async (e) => {
  e.preventDefault();
  const datos = Object.fromEntries(new FormData(e.target));
  const { data: compra, error } = await supabaseClient.from('compras_alimento').insert([datos]).select().single();
  if (error) return alert(error.message);

  const totalCompra = Number(datos.cantidad) * Number(datos.precio_unidad);
  if (datos.metodo_pago !== 'CREDITO' && datos.cuenta_id) {
    await supabaseClient.from('movimientos_cuenta').insert([{
      fecha: datos.fecha, cuenta_id: datos.cuenta_id, tipo: 'SALIDA',
      categoria: 'COMPRA_ALIMENTO', concepto: `Compra alimento (${datos.cantidad} bultos)`,
      valor: totalCompra, referencia_id: compra.id
    }]);
  }
  alert('Compra de alimento registrada');
  e.target.reset();
  cargarTodo();
});

document.getElementById('form-lote').addEventListener('submit', async (e) => {
  e.preventDefault();
  const datos = Object.fromEntries(new FormData(e.target));
  const { error } = await supabaseClient.from('lotes').insert([datos]);
  if (error) return alert(error.message);
  alert('Lote creado');
  e.target.reset();
  cargarTodo();
});

document.getElementById('form-despacho').addEventListener('submit', async (e) => {
  e.preventDefault();
  const datos = Object.fromEntries(new FormData(e.target));
  const { error } = await supabaseClient.from('despachos_alimento').insert([datos]);
  if (error) return alert(error.message);
  alert('Despacho registrado');
  e.target.reset();
  cargarTodo();
});

document.getElementById('form-catalogo-alimento').addEventListener('submit', async (e) => {
  e.preventDefault();
  const datos = Object.fromEntries(new FormData(e.target));
  const { error } = await supabaseClient.from('catalogo_alimentos').insert([datos]);
  if (error) return alert(error.message);
  alert('Alimento agregado al catálogo');
  e.target.reset();
  cargarSelectores();
});

// 9. REPORTES Y EXPORTACIÓN EXCEL
async function cargarVistaReporte() {
  const vista = document.getElementById('tipo-reporte').value;
  const titulo = document.getElementById('tipo-reporte').selectedOptions[0].text;
  document.getElementById('titulo-reporte-impresion').textContent = titulo;

  const { data } = await supabaseClient.from(vista).select('*');
  datosReporteActual = data || [];
  const tabla = document.getElementById('tabla-reporte-dinamico');

  if (!datosReporteActual.length) {
    tabla.innerHTML = '<tr><td class="p-4 text-center text-slate-400">No hay registros para este informe</td></tr>';
    return;
  }

  const columnas = Object.keys(datosReporteActual[0]).filter(c => !c.endsWith('_id') && c !== 'id');
  tabla.innerHTML = `
    <thead class="bg-slate-100 border-b">
      <tr>${columnas.map(c => `<th class="p-2 uppercase">${c.replaceAll('_', ' ')}</th>`).join('')}</tr>
    </thead>
    <tbody class="divide-y">
      ${datosReporteActual.map(fila => `<tr>${columnas.map(c => `<td class="p-2">${fila[c] ?? ''}</td>`).join('')}</tr>`).join('')}
    </tbody>
  `;
}

function exportarExcel() {
  if (!datosReporteActual.length) return alert('No hay datos para exportar');
  const hoja = XLSX.utils.json_to_sheet(datosReporteActual);
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, 'Informe');
  const nombre = document.getElementById('tipo-reporte').value;
  XLSX.writeFile(libro, `${nombre}_${new Date().toISOString().split('T')[0]}.xlsx`);
}