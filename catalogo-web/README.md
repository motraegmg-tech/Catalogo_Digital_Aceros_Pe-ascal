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
- **Teléfono y tableta (≤880 px)**: la barra superior se reacomoda en dos filas y concentra
  todo lo necesario — logo · **sucursal** · **Pedido** arriba, y **buscador** · **Categorías**
  · **formato de vista** abajo. Las categorías ya no desaparecen: el botón abre un panel
  deslizable con la misma lista de escritorio (mismo marcado, sin código duplicado).
  El **formato de vista** alterna cuadrícula de 2 columnas y lista compacta, y se recuerda
  en el navegador (`ap_view`). El carrito ocupa la pantalla completa y respeta el notch
  (`env(safe-area-inset-*)`).
- **Vista previa al compartir el enlace** (WhatsApp/Facebook/Telegram): etiquetas Open Graph
  en `index.html` con `assets/og-cover-v2.jpg` (1200×630, 50 KB). ⚠️ `og:url` y `og:image`
  deben ser **absolutas**: si cambia el dominio, actualiza las 5 líneas marcadas con
  `[DOMINIO]`. **Para reemplazar la imagen hay que renombrar el archivo** (`-v3`, `-v4`…):
  Facebook y WhatsApp la cachean por URL, y añadir `?v=N` a la página no sirve porque el
  `og:url` canónico devuelve al rastreador a la ficha ya guardada.

## Clasificador de catálogo (herramienta interna)
`clasificador.html` es la herramienta de curación manual: permite revisar y mover
cada uno de los 3,222 productos entre categorías/subcategorías viendo los conteos
y el avance en vivo. Corre igual que el catálogo: **doble clic**, sin servidor.

- **Árbol de taxonomía editable de 3 niveles** (categoría → subcategoría →
  **sub-subcategoría**): crear (＋), renombrar/fusionar (✎) y eliminar (✕) en
  cualquier nivel; los productos afectados se reubican de forma segura (nunca se
  pierden: a lo sumo vuelven a POR CLASIFICAR o al nivel superior).
- **Clasificación**: selección múltiple (clic, Shift+clic, **barrido** manteniendo
  el clic izquierdo y arrastrando sobre las filas, o "seleccionar todos"),
  barra de asignación, **arrastrar y soltar** las filas seleccionadas al árbol,
  y ficha individual con edición de nombre/medidas/proveedor.
- **Mover en bloque (⇄ en el árbol)**: mueve TODOS los productos de una categoría,
  subcategoría o sub-subcategoría a otro destino en una sola operación (el origen
  se conserva vacío en la taxonomía por si quieres reutilizarlo); reversible con
  Deshacer.
- **Sugerencias**: reglas por palabra clave (port de `categorizar_v1.ps1`) +
  similitud contra lo ya clasificado (marcadas con `≈`). Se aplican con un clic;
  nada es automático.
- **Seguridad del trabajo**: autoguardado en localStorage (solo deltas), botón
  Deshacer (Ctrl+Z), bitácora de cambios, exportar/importar avance (.json, formato
  v2 con 3 niveles; los respaldos v1 se migran solos al importarlos).
- **Conexión directa con el catálogo**: con el botón "🔗 Conectar con el catálogo"
  (barra superior) eliges UNA vez la carpeta `catalogo-web/data/`; desde entonces
  **cada cambio reescribe solo `productos.js` y `productos.json`** ahí mismo — los
  cambios viven en el código original y el catálogo se actualiza al refrescarlo.
  El permiso queda recordado (IndexedDB); al reabrir, el navegador puede pedir
  reconfirmar con un clic ("Reconectar"). Requiere Edge/Chrome (File System
  Access API).
- **Entregables (respaldo manual)**: exporta `catalogo_categorizado.csv` (columnas
  del pipeline + `subtipo` para el 3er nivel) y `productos.js` / `productos.json`
  regenerados (incluyen campo `sub2`), por si prefieres reemplazar a mano.
- **Vista catálogo**: alterna la lista de trabajo por una cuadrícula de tarjetas
  para ver cómo va quedando cada categoría.
- Atajos: `/` buscar · `Esc` cerrar/deseleccionar · `Ctrl+Z` deshacer · `←/→` navegar fichas.
- Autoprueba: abrir `clasificador.html?selftest=1` (franja PASS/FAIL al pie).

## Llenado de fotos (operativa posterior)
Ver `fotos\LEEME.txt`. Resumen: guardar cada imagen en `fotos\` con el nombre por
código indicado en `..\datos\plantilla_fotos.csv` (`.webp/.jpg/.png`). Aparecen solas.

## Estructura
```
catalogo-web/
  index.html          catálogo público (prototipo)
  clasificador.html   herramienta interna de clasificación
  manifest.webmanifest
  assets/   styles.css · app.js · clasificador.css · clasificador.js
            logo-ap-oficial.jpg  logo oficial completo (azul marino + cuadro rojo óxido)
            logo-ap-marca.png    solo el monograma — encabezado e iconos
            og-cover-v2.jpg      vista previa al compartir el enlace (1200×630)
            og-cover.jpg         copia idéntica del anterior (nombre viejo, cacheado
                                 en Facebook; se puede borrar más adelante)
            icon-192 / 512 / maskable-512.png   iconos PWA
            logo-ap.jpg/.png     versión metalizada, ya NO se usa en el catálogo
                                 (sigue en clasificador.html)
  data/     productos.js (app) · productos.json (import futuro)
  fotos/    imágenes por código (LEEME.txt)
```

## Pendiente / roadmap
- **Datos:** pase de IA fino para los 501 "POR CLASIFICAR" + atributos/funcionamiento.
- **Backend Supabase:** tablas + RLS (solo dueños editan), 5 sucursales con stock por punto,
  precios y existencias (al conectar el software de tienda), proveedores internos, bitácora.
- **Editor avanzado:** subir fotos desde el panel, validación, asistencia IA.
- Las 5 sucursales y sus WhatsApp están en `assets/app.js` (CONFIG.sucursales) — editable.
