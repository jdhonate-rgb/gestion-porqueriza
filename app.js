const moneda = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });

// 1. GESTIÓN DE SESIÓN
document.addEventListener('DOMContentLoaded', async () => {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session) {
    iniciarApp(session.user);
  }
});

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error');

  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) {
    errorEl.textContent = 'Credenciales incorrectas o usuario no confirmado.';
    errorEl.classList.remove('hidden');
  } else {
    errorEl.classList.add('hidden');
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

  const { data: perfil } = await supabaseClient
    .from('usuarios')
    .select('nombre, rol')
    .eq('auth_user_id', user.id)
    .single();

  if (perfil) {
    document.getElementById('user-badge').textContent = `${perfil.nombre} (${perfil.rol})`;
  }

  await Promise.all([
    cargarDashboard(),
    cargarSelectores(),
    cargarStockAlimento(),
    cargarConversion(),
    cargarVentas()
  ]);
}

// 2. NAVEGACIÓN DE PESTAÑAS
function cambiarTab(tabId) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
  document.getElementById(`tab-${tabId}`).classList.remove('hidden');

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('bg-emerald-100', 'text-emerald-800');
    if (btn.dataset.tab === tabId) {
      btn.classList.add('bg-emerald-100', 'text-emerald-800');
    }
  });
}

// 3. DASHBOARD GERENCIAL Y RENTABILIDAD
async function cargarDashboard() {
  const { data: kpi } = await supabaseClient.from('dashboard_gerencial').select('*').single();
  if (kpi) {
    const tarjetas = [
      { titulo: 'Lotes Activos', valor: kpi.lotes_activos },
      { titulo: 'Cerdos Disponibles', valor: kpi.cerdos_disponibles },
      { titulo: 'Inventario Alimento', valor: moneda.format(kpi.valor_inventario_alimento) },
      { titulo: 'Ventas del Mes', valor: moneda.format(kpi.ventas_mes) },
      { titulo: 'Recaudo del Mes', valor: moneda.format(kpi.recaudo_mes) },
      { titulo: 'Cartera Pendiente', valor: moneda.format(kpi.cartera_pendiente_total) },
      { titulo: 'Mortalidad Acum.', valor: `${kpi.mortalidad_acumulada_porcentaje}%` },
      { titulo: 'Gastos Operativos Mes', valor: moneda.format(Number(kpi.otros_gastos_mes) + Number(kpi.costos_sanitarios_mes)) }
    ];

    document.getElementById('kpi-grid').innerHTML = tarjetas.map(t => `
      <div class="bg-white p-4 rounded-xl shadow-sm border-l-4 border-emerald-600">
        <p class="text-xs text-slate-500 uppercase">${t.titulo}</p>
        <p class="text-xl font-bold mt-1">${t.valor}</p>
      </div>
    `).join('');
  }

  const { data: lotes } = await supabaseClient.from('reporte_produccion_lotes').select('*').order('fecha_inicio', { ascending: false });
  if (lotes) {
    document.getElementById('tabla-rentabilidad-lotes').innerHTML = lotes.map(l => `
      <tr>
        <td class="p-2 font-medium">${l.codigo}</td>
        <td class="p-2">${l.nombre}</td>
        <td class="p-2 font-bold">${l.cantidad_disponible} / ${l.cantidad_inicial}</td>
        <td class="p-2">${l.mortalidad_porcentaje}%</td>
        <td class="p-2">${moneda.format(l.costo_acumulado)}</td>
        <td class="p-2">${moneda.format(l.ventas_registradas)}</td>
        <td class="p-2 font-bold ${l.resultado_bruto_estimado >= 0 ? 'text-emerald-600' : 'text-red-600'}">
          ${moneda.format(l.resultado_bruto_estimado)}
        </td>
      </tr>
    `).join('');
  }
}

// 4. SELECTORES Y FORMULARIOS
async function cargarSelectores() {
  const { data: lotes } = await supabaseClient.from('lotes').select('id, codigo, nombre').eq('estado', 'ACTIVO');
  const opcionesLotes = '<option value="">Selecciona lote activo...</option>' +
    (lotes || []).map(l => `<option value="${l.id}">${l.codigo} - ${l.nombre}</option>`).join('');

  ['select-lote-pesaje', 'select-lote-despacho', 'select-lote-mortalidad'].forEach(id => {
    document.getElementById(id).innerHTML = opcionesLotes;
  });

  const { data: alimentos } = await supabaseClient.from('catalogo_alimentos').select('id, nombre').eq('activo', true);
  document.getElementById('select-alimento-despacho').innerHTML = '<option value="">Selecciona alimento...</option>' +
    (alimentos || []).map(a => `<option value="${a.id}">${a.nombre}</option>`).join('');
}

document.getElementById('form-lote').addEventListener('submit', async (e) => {
  e.preventDefault();
  const datos = Object.fromEntries(new FormData(e.target));
  const { error } = await supabaseClient.from('lotes').insert([datos]);
  if (error) return alert('Error: ' + error.message);
  alert('Lote creado correctamente');
  e.target.reset();
  cargarDashboard();
  cargarSelectores();
});

document.getElementById('form-pesaje').addEventListener('submit', async (e) => {
  e.preventDefault();
  const datos = Object.fromEntries(new FormData(e.target));
  const { error } = await supabaseClient.from('pesajes_lote').insert([datos]);
  if (error) return alert('Error: ' + error.message);
  alert('Pesaje registrado');
  e.target.reset();
  cargarConversion();
});

document.getElementById('form-despacho').addEventListener('submit', async (e) => {
  e.preventDefault();
  const datos = Object.fromEntries(new FormData(e.target));
  const { error } = await supabaseClient.from('despachos_alimento').insert([datos]);
  if (error) return alert('Error: ' + error.message);
  alert('Despacho registrado');
  e.target.reset();
  cargarStockAlimento();
  cargarDashboard();
});

document.getElementById('form-mortalidad').addEventListener('submit', async (e) => {
  e.preventDefault();
  const datos = Object.fromEntries(new FormData(e.target));
  const { error } = await supabaseClient.from('mortalidad').insert([datos]);
  if (error) return alert('Error: ' + error.message);
  alert('Mortalidad registrada');
  e.target.reset();
  cargarDashboard();
});

// 5. TABLAS SECUNDARIAS
async function cargarStockAlimento() {
  const { data } = await supabaseClient.from('stock_alimento').select('*');
  if (data) {
    document.getElementById('tabla-stock-alimento').innerHTML = data.map(s => `
      <tr>
        <td class="p-2 font-medium">${s.alimento}</td>
        <td class="p-2 ${s.cantidad_stock <= s.stock_minimo ? 'text-red-600 font-bold' : ''}">${s.cantidad_stock}</td>
        <td class="p-2">${moneda.format(s.costo_promedio_unidad)}</td>
        <td class="p-2 font-semibold">${moneda.format(s.valor_stock)}</td>
      </tr>
    `).join('');
  }
}

async function cargarConversion() {
  const { data } = await supabaseClient.from('reporte_conversion_alimenticia').select('*');
  if (data) {
    document.getElementById('tabla-conversion').innerHTML = data.map(c => `
      <tr>
        <td class="p-2 font-medium">${c.codigo} - ${c.nombre}</td>
        <td class="p-2">${c.dias_en_granja}</td>
        <td class="p-2">${c.peso_inicial_promedio_kg} kg</td>
        <td class="p-2">${c.ultimo_peso_promedio_kg} kg</td>
        <td class="p-2 font-semibold">${c.ganancia_diaria_peso_kg} kg</td>
        <td class="p-2">${c.kilos_alimento_consumido} kg</td>
        <td class="p-2 font-bold text-blue-700">${c.conversion_alimenticia_estimada}</td>
      </tr>
    `).join('');
  }
}

async function cargarVentas() {
  const { data } = await supabaseClient.from('reporte_ventas_cartera').select('*').order('fecha', { ascending: false });
  if (data) {
    document.getElementById('tabla-ventas').innerHTML = data.map(v => `
      <tr>
        <td class="p-2">${v.fecha}</td>
        <td class="p-2">${v.lote_codigo}</td>
        <td class="p-2">${v.cliente || 'General'}</td>
        <td class="p-2">${v.cantidad_cerdos} (${v.kilos} kg)</td>
        <td class="p-2 font-semibold">${moneda.format(v.total)}</td>
        <td class="p-2 text-red-600">${moneda.format(v.saldo)}</td>
        <td class="p-2"><span class="px-2 py-0.5 rounded text-xs bg-slate-200">${v.estado_pago}</span></td>
      </tr>
    `).join('');
  }
}