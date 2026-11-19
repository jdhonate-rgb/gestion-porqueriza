# Granja porcina (aplicación web)

Aplicación para controlar una granja porcina: lotes, compra de cerdos, alimento, ventas, cartera y liquidación.
Funciona en celular, tablet y computador desde el navegador, y se puede agregar a la pantalla de inicio.

Este repositorio es **público** y solo contiene la aplicación. No guarda datos del negocio: los datos están en
Supabase detrás de un inicio de sesión, y la base de datos (esquema, reglas y documentación) vive en un
repositorio privado.

## Qué incluye hoy

- Inicio de sesión y permisos por rol (dueño / auxiliar)
- Inicio con el estado general de la granja
- Lotes
- Compra de cerdos: adelantos, abonos, pago total y partos de las cerdas
- Ruta de cobro automática: sale sola la lista de quién toca cobrar (atrasados, hoy, próximos), con tarjeta por cliente (cobrar, visita, promesa, llamar, WhatsApp, mapa). Los clientes y sus deudas se crean desde "Nuevo cliente"
- Editar y eliminar (con confirmación) en clientes, deudas, cobros, visitas y compras de cerdos
- Cuentas (solo dueño): Bancolombia (transferencias) y Efectivo porqueriza, con saldo inicial, detalle de cada movimiento, movimientos manuales y traslados entre cuentas; los cobros y pagos entran solos
- Ventas: por kilo, de contado o a crédito (con abono inicial y fecha de cobro); detalle, pagos, editar y eliminar
- Sacrificio y Bajas: registro por lote con control de inventario, editar y eliminar
- Compra de alimento y Bodega: la compra entra sola a bodega, salidas a cada lote con costo promedio, consumo por lote; editar y eliminar

Los demás módulos aparecen en el menú como "Pronto" y se activan por fases.

## Publicar en GitHub Pages

1. En el repositorio: **Settings → Secrets and variables → Actions → New repository secret**.
   Crea dos secretos:
   - `SUPABASE_URL`: la Project URL de Supabase
   - `SUPABASE_ANON_KEY`: la clave **anon** (nunca la `service_role`)
2. **Settings → Pages → Source: GitHub Actions**.
3. Cada `push` a `main` publica la aplicación. El workflow genera `config.js` con esos secretos.

## Probar en tu equipo

```bash
cp config.example.js config.js     # pon tu URL y anon key
python3 -m http.server 8080        # abre http://localhost:8080
```

`config.js` está en `.gitignore` y no se sube.

## Estructura

```
index.html
css/styles.css
js/main.js            sesión, menú y rutas
js/lib.js             formatos, mensajes, ventanas modales
js/modules/           un archivo por módulo
```

## Seguridad

- Solo se usa la clave `anon`. Es pública por diseño: lo que protege los datos son el inicio de sesión y las
  reglas de seguridad por filas (RLS) de la base de datos.
- En Supabase conviene desactivar el registro abierto (**Authentication → Sign In / Providers →
  Allow new users to sign up**) para que solo el administrador cree usuarios.
- Nunca subas claves `service_role`, contraseñas ni archivos `.env`.

- **Gastos**: por lote y tipo (operativo, medicamento, gasolina, otro, préstamo al operador), con método de pago que alimenta Cuentas; crear, editar y eliminar.
- **Liquidación** (solo dueño): se calcula por lotes y período; descuentos de inversiones y préstamos editables; al cerrar queda de solo lectura.
- **Granja** (solo dueño): inversiones con método de pago (salen de Cuentas), saldo por recuperar; las ya descontadas en una liquidación cerrada están protegidas.
