# Catálogo Digital · Aceros Peñascal (prototipo PWA)

Prototipo funcional del catálogo comercial. Autocontenido: corre **sin servidor**
(doble clic en `index.html`) y sin internet. Diseñado para migrar después a
**Supabase + Next.js** sin rehacer la interfaz.

## Cómo abrirlo
- **Rápido:** doble clic en `index.html` (los datos se cargan desde `data/productos.js`).
- **Como app/PWA instalable:** servir la carpeta por HTTP, p. ej. `npx serve` en
  `catalogo-web\` y abrir la URL. (El manifest y la instalación requieren HTTP.)

## Qué incluye (estado actual)
- **3,222 productos** reales en **14 categorías** con subcategorías.
- Navegación por categoría/subcategoría + **búsqueda** tolerante a acentos (nombre, código, medida).
- **Ficha** de producto con foto (o marcador "Sin foto").
- **Carrito → WhatsApp**: arma el pedido y lo envía al WhatsApp de la **sucursal elegida**
  (5 sucursales con su número). No muestra precios: el equipo cotiza al recibirlo.
- **Modo Admin** (botón "Admin"): edición inline de campos (demo guardada en el navegador).
  Es el esqueleto del editor que, al conectar Supabase, persistirá en la base con control por rol.
- **Paleta industrial**: grises/plata/negro/platino/blanco + acentos rojo óxido, verde zintro,
  verde oscuro, aqua oscuro y beige arena.

## Llenado de fotos (operativa posterior)
Ver `fotos\LEEME.txt`. Resumen: guardar cada imagen en `fotos\` con el nombre por
código indicado en `..\datos\plantilla_fotos.csv` (`.webp/.jpg/.png`). Aparecen solas.

## Estructura
```
catalogo-web/
  index.html
  manifest.webmanifest
  assets/   styles.css · app.js · logo-ap.png
  data/     productos.js (app) · productos.json (import futuro)
  fotos/    imágenes por código (LEEME.txt)
```

## Pendiente / roadmap
- **Datos:** pase de IA fino para los 501 "POR CLASIFICAR" + atributos/funcionamiento.
- **Backend Supabase:** tablas + RLS (solo dueños editan), 5 sucursales con stock por punto,
  precios y existencias (al conectar el software de tienda), proveedores internos, bitácora.
- **Editor avanzado:** subir fotos desde el panel, validación, asistencia IA.
- Las 5 sucursales y sus WhatsApp están en `assets/app.js` (CONFIG.sucursales) — editable.
