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
- Navegación por categoría/subcategoría + **búsqueda que entiende cómo habla el cliente de acero**
  (ver abajo): tolerante a acentos, y además a fracciones, decimales, unidades habladas y al
  vocabulario de mostrador que el encargado le enseñe.
- **Ficha** de producto con foto (o marcador "Sin foto").
- **Orden alfabético A→Z de corrido** (decisión de Gonzalo, 2026-07-31). Navegando, *todo*
  va A→Z en **una sola pasada**: los productos, la lista de categorías, los chips de
  subcategoría y las tarjetas de la grilla —sean fichas de familia o productos sueltos, van
  entremezcladas. Buscando manda el ranking de relevancia de `searchService`.
  ⚠️ Esto **reemplaza** la regla anterior de «con foto primero», que partía el catálogo en
  dos abecedarios: se bajaba hasta la Z y volvía a empezar en la A con los 357 sin foto.
  Para recuperarla habría que volver a partir la lista en `filteredProducts()`.
- **Fichas de familia**: dentro de una categoría, los productos que solo cambian de medida
  (las 32 soleras) o de modelo dentro de una marca/función (los discos de corte) se
  presentan como **una sola tarjeta**. Al abrirla trae la **tabla de medidas** con su
  código y un contador por fila, y un botón que manda **todas las medidas elegidas de una
  vez** al pedido. Detalle abajo.
- **Destacados en la portada**: al abrir el catálogo (sin buscar ni elegir categoría) sale
  primero lo que el encargado puso al frente desde el clasificador — productos sueltos y/o
  fichas de familia mezclados, en el orden que él decidió. Si la lista está vacía, la portada
  se comporta como siempre. Sale de `ajustes.destacados` en Supabase.
- **Carrito → WhatsApp**: arma el pedido y lo envía al WhatsApp de la **sucursal elegida**.
  Las sucursales (nombre, WhatsApp y dirección) salen de la tabla `sucursales` y se editan
  desde el clasificador; `core/config.js` queda como respaldo si la base no responde.
  No muestra precios: el equipo cotiza al recibirlo.
- **Dirección de la sucursal en el pedido**: recuadro propio, rotulado *«Dirección de la
  Sucursal:»*, con la dirección a 15 px y el contorno en rojo óxido (`--oxido`, el del logo).
  Sólo el contorno va en color: rellenarlo competiría con el botón de WhatsApp, que es la
  acción que debe destacar. Al tocarla abre Google Maps, y debajo lo dice en letra chica.
- **Registro de uso** (`core/metricsService.js`): cada vista de ficha, cada producto que entra
  al pedido y cada pedido enviado dejan un renglón en `eventos_catalogo`. Es lo que alimenta
  «lo que más piden» en el clasificador. **No se guarda nada del visitante** — ni IP, ni
  cookie, ni identificador: sólo el código del producto, la cantidad y la sucursal. Nunca
  bloquea: si falla, el pedido sigue su curso.
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

## Búsqueda: entender cómo habla el cliente

Quien compra acero no escribe como está capturado el catálogo. Pide *«media pulgada»*,
*«PTR de 2x2»*, *«un octavo»*; el catálogo dice `1/2"`, `PTR50X50`, `SOLERA`. Antes eran
cuatro búsquedas distintas y tres devolvían cero — y **cero resultados es una venta que se
pierde sin que nadie se entere**.

`core/searchService.js` lo resuelve en tres capas que se suman:

| Capa | Qué traduce | Dónde vive |
|---|---|---|
| **Fracciones y decimales** | `1/2` ↔ `0.5`, `1.5` ↔ `1 1/2`, `3/16` ↔ `0.1875` | código (regla general) |
| **Unidades habladas** | «pulgada» → `"` · «milímetros» → `mm` · «calibre» → `c` | código (regla general) |
| **Vocabulario de mostrador** | «PTR» → tubular cuadrado · «varilla» → redondo corrugado | `ajustes.sinonimos_busqueda`, **editable** |

**Regla de oro: un sinónimo SUMA, nunca sustituye.** Lo que el cliente escribió sigue siendo
una forma válida de encontrar el producto, así que una traducción mal puesta no puede hacer
desaparecer resultados que antes salían. Y lo que coincide **literalmente** se ordena antes que
lo que llegó por traducción: el diccionario ayuda, no manda.

Por dentro, la consulta se parte en **grupos** con varias **alternativas**, y un producto entra
si *cada* grupo tiene *alguna* alternativa satisfecha — un Y de oes:

```
«ptr 1/2 pulgada»  →  [ptr | tubular+cuadrado]  Y  [1/2 | 0.5]  Y  ["]
```

⚠️ El diccionario se consulta **antes** de tirar las palabras vacías (`de`, `un`, `x`…) y
siempre por la frase más larga. Si no, «un octavo» perdería el «un» al limpiar y su entrada no
volvería a casar nunca, y «media» se comería el par antes de que «media pulgada» tuviera turno.

**El círculo se cierra solo:** el catálogo registra cada búsqueda con cuántos resultados dio
(`eventos_catalogo`), y el clasificador muestra en **Destacados** un recuadro
*«⚠ Buscaron esto y no encontraron nada»* con dos botones por término — **enseñar palabra**
(el producto existe pero se llama de otro modo) o **dar de alta** (falta el producto).

## Fichas de familia (agrupaciones)

Una categoría con veinte soleras seguidas obliga al cliente a buscar su medida a fuerza de
paciencia. La ficha de familia junta esas veinte en **una tarjeta** y mueve la elección de
medida adentro. Es agrupación de **presentación**: cada medida sigue siendo su propio
producto con su propio código, y así entra al carrito y al mensaje de WhatsApp.

**Por qué se agrupan (criterio).** No todo se agrupa por medida: las láminas se distinguen
por **calibre**, los discos por **función** (corte, desbaste, diamante), la herramienta por
**modelo**. Cada agrupación lleva su criterio, y el criterio **decide el rótulo de la columna
donde el cliente elige** — encabezar «Medida» una tabla de calibres manda al cliente a buscar
lo que no va a encontrar. El rótulo también se puede escribir a mano por agrupación
(`columna`), y los criterios disponibles se editan desde el clasificador
(`ajustes.criterios_agrupacion`), así que se pueden inventar nuevos sin tocar código.

**Dónde agrupa y dónde no** (decisión de Gonzalo, 2026-07-31):

| Dónde está el cliente | Qué ve |
|---|---|
| **Todas las categorías** | Todas las fichas, **una por producto** — sin agrupar |
| **Dentro de una categoría** | Las familias aprobadas como ficha única, más los productos sueltos |
| **Buscando algo** | Resultados **producto por producto** (la búsqueda no agrupa) |

Solo se agrupa **lo aprobado a mano**: una familia sin aprobar sigue mostrando sus productos
sueltos. Hoy son **173 fichas** que cubren **1,576 productos**; navegando por categoría el
catálogo pasa de 3,222 a **1,831 tarjetas**.

Dentro de la ficha las filas van **por medida de menor a mayor**, comparando todos los
números (`1/8 X 1/2"` → `1/8 X 1"` → `1/8 X 1 1/2"` → `3/16 X 1/2"`), con milímetros
convertidos a pulgadas.

La tarjeta de familia lleva la **misma etiqueta de subcategoría** que un producto suelto
(«Solera», «Ángulos»), calculada sobre los productos que la ficha muestra hoy —no sobre el
dato guardado al aprobarla—, y la ficha abre con la ruta **Categoría › Subcategoría**. Las
14 familias que traen subgrupos de verdad (Discos → Corte · Desbaste · Diamante…) los
muestran como secciones dentro de la tabla.

### En qué categoría aparece la ficha

**En la que están sus productos, no en la que dice el campo `cat`.** La calcula
`catPrincipalDe()` en cada carga: la categoría donde la familia tiene más productos
(desempate alfabético, para que dos cargas seguidas no den resultados distintos).

⚠️ Esto **no es un detalle**: `cat` lo elige una persona al crear la agrupación y se queda
atrás en cuanto los productos se reclasifican o se agregan de otra categoría. Cuando el
catálogo hacía caso a ese campo, la ficha **desaparecía de las dos categorías a la vez** —
en la declarada no había productos suyos, y en la real se descartaba porque `cat` no
coincidía. Nadie la veía nunca y nada avisaba. Pasó de verdad el 2026-08-02 con una
agrupación creada en «Perfiles Macizos» cuyos productos estaban en «Fierro Vaciado y
Decorativo».

El clasificador ahora lo señala en tres momentos, para que el dato tampoco quede mintiendo:
en la tarjeta de la lista (*«se ve en X, no en Y»*), dentro del editor (recuadro ámbar con
el reparto real y un botón que lo cuadra) y **al guardar**, ofreciendo corregir la categoría.

Una familia que abarca dos categorías se muestra completa **solo en su categoría principal**,
para no salir duplicada ni partida. Sus pocos productos de otra categoría siguen apareciendo
ahí como tarjetas sueltas, así que no se esconde nada.

> Recordatorio: **en «Todas las categorías» y buscando, el catálogo nunca agrupa** (decisión
> de Gonzalo, 2026-07-31). Una agrupación sólo se ve al entrar a una categoría. Si acabas de
> crearla y no aparece, comprueba primero que estás **dentro** de su categoría.

### Foto de portada de la agrupación

Sin foto propia, la tarjeta **toma prestada** la del primer producto que tenga una. Sirve de
emergencia, pero una ficha «Solera» se vende mejor con la foto del producto genérico que con
la de la medida que casualmente quedó primera.

Por eso `familias.foto` guarda una foto propia, que **siempre gana**. Se pone desde el editor
(paso 1, junto al nombre) con el **mismo editor de recorte** que ya usan los productos —
encuadre, zoom, rotación, tamaño y formato— y se sube al bucket `fotos` como
`familia-<id>-<timestamp>.webp`. Quitarla devuelve el comportamiento automático.

En la lista de agrupaciones, las que ya tienen foto propia llevan la miniatura con **borde
aqua**; las que la toman prestada, borde gris. Así se ve de un vistazo qué falta por curar.

> La foto se sube a Storage al recortarla, pero la fila **sólo cambia al pulsar «Guardar
> agrupación»** — como todo lo demás del editor, para que *Cancelar* siga significando cancelar.

### Dónde viven y cómo se editan

**La fuente de verdad es la tabla `familias` de Supabase**, y se edita desde
`clasificador.html` → pestaña **Agrupaciones**: crear, renombrar, cambiar el criterio, poner
foto, agregar y quitar productos, partir en subgrupos, ocultar y eliminar. Con vista previa de
cómo queda en el catálogo. **Ya no hace falta correr nada ni tocar archivos.**

Las **173 agrupaciones aprobadas ya están cargadas** en la base (sembradas el 2026-08-02 desde
`data/familias.json`, verificadas código por código: 1,576 códigos, huella MD5 idéntica).

`data/familias.json` / `.js` quedan como **respaldo**: es lo que usa el catálogo cuando no
hay conexión (doble clic en `index.html`), y lo que el botón *«⤒ Importar del respaldo»*
sube a la base si alguna vez hay que reconstruirla (sólo agrega lo que falta; **no pisa** lo
editado a mano). No se regeneran solos: si quieres refrescarlos con lo que hoy está en línea,
corre el pipeline de abajo.

El pipeline original **sigue existiendo** para proponer agrupaciones nuevas a partir de los
nombres de producto (es análisis en lote, no algo que el encargado deba hacer a mano):

```
node pipeline/proponer_familias.mjs          # propone (no decide nada)
   → datos/familias_propuestas.json/.csv
node pipeline/generar_revision_familias.mjs  # pantalla para aprobar/descartar
   → datos/revision_familias.html
   ↳ las decisiones se guardan en datos/familias_aprobadas.json
node pipeline/generar_familias_catalogo.mjs  # escribe el respaldo local
   → catalogo-web/data/familias.json (+ .js para el modo sin servidor)
```

⚠️ Ese último paso escribe **el respaldo**, no la base. Para que lo aprobado llegue al
catálogo hay que importarlo desde el clasificador (*Agrupaciones → ⤒ Importar del respaldo*),
que sólo agrega las que faltan y **no pisa** lo que ya se editó a mano.

Una agrupación sólo muestra lo que hoy sigue publicado y clasificado: un producto retirado,
oculto o devuelto a "POR CLASIFICAR" sale de la ficha, que se encoge sola. Si no carga
ninguna de las dos fuentes, el catálogo funciona exactamente como antes, producto por producto.

## Clasificador de catálogo (herramienta interna)
`clasificador.html` es **el panel de administración del catálogo**, pensado para que el
encargado de Aceros Peñascal —que no programa— pueda mantenerlo entero sin ayuda. Corre
igual que el catálogo: **doble clic**, sin servidor.

Está dividido en **cinco pestañas**, una por tipo de trabajo:

| Pestaña | Para qué |
|---|---|
| 📦 **Productos** | Dar de alta, corregir, poner foto, clasificar y retirar productos |
| 🗂 **Agrupaciones** | Qué productos se muestran juntos en una tarjeta y **con qué criterio** |
| ⭐ **Destacados** | Qué sale primero en la portada, con la cuenta real de lo que piden los clientes |
| 🏬 **Sucursales y textos** | Direcciones, WhatsApp, rótulos del catálogo y tipos de agrupación |
| ❓ **Cómo se usa** | La guía paso a paso, dentro de la propia herramienta |

> ⚠️ **Para que los cambios lleguen al catálogo hay que iniciar sesión** en *Guardar /
> Exportar* (indicador **«● En línea»**). Sin sesión todo se guarda **sólo en esa
> computadora** y nadie más lo ve. Es la misma sesión de siempre, ahora también para altas,
> bajas y agrupaciones. El encargado necesita su propio usuario en Supabase → Authentication.

### 📦 Productos — alta, baja y edición
- **＋ Nuevo producto** (barra superior): código, nombre, medida, categoría y proveedor. El
  código es obligatorio y único; se avisa si ya existe y se dice qué producto lo usa. Al
  crearlo se abre su ficha para ponerle foto.
- **⧉ Duplicar producto** (en la ficha): capturar la misma pieza en doce medidas dejaría de
  ser trabajo humano — duplicar deja todo puesto y sólo hay que cambiar código y medida.
- **✎ cambiar** (junto al código, sólo en productos capturados aquí): corrige un código mal
  escrito. Por dentro es una baja y un alta, porque el código *es* la identidad de la fila en
  Supabase; se conservan nombre, medida, categoría y proveedor, y hay que volver a subir la foto.
- **🚫 Retirar del catálogo**: deja de verse para el cliente pero **no se pierde** (queda en
  «Productos Descontinuados / Ocultos» y se devuelve moviéndolo a su categoría). Es la baja normal.
- **🗑 Eliminar**: borrado de verdad en la base. Sólo para deshacer una captura equivocada;
  el diálogo lo dice con todas sus letras cuando el producto viene del catálogo original.
- Los productos capturados aquí se distinguen en la lista por una **franja verde** a la izquierda.
- Las altas y bajas viajan a Supabase como `INSERT`/`DELETE` **antes** que las
  reclasificaciones: un `UPDATE` sobre una fila que todavía no existe no fallaría, sólo no
  escribiría nada, y el producto se quedaría "sincronizado" sin estar en la base.

### 🗂 Agrupaciones — el editor de fichas de familia
- Tarjeta por agrupación con su categoría, criterio, rótulo de columna, nº de productos y
  los subgrupos que tiene. Buscador por nombre, categoría **o por producto** («¿en qué
  agrupación quedó este código?»).
- **＋ Nueva agrupación**, o **＋ Con lo seleccionado**: selecciona productos en la pestaña
  Productos y llegan ya puestos.
- El editor va en cuatro pasos: **qué es** (foto de portada, nombre, categoría, descripción) →
  **por qué se agrupan** (el criterio, elegido entre tarjetas que explican cuándo usar cada una)
  → **qué productos entran** (agregar, quitar, dividir en subgrupos, mover entre ellos, ordenar
  por medida) → **vista previa** de cómo queda en el catálogo.
- Avisa si un producto ya pertenece a otra agrupación: el catálogo no sabría en cuál mostrarlo.
- **🚫 Ocultar** desactiva la agrupación sin borrarla (sus productos vuelven a verse sueltos);
  **🗑** la elimina — en ningún caso se borran productos.

### ⭐ Destacados — y qué piden de verdad los clientes
- Lista ordenada que mezcla productos y agrupaciones (▲▼ para moverlas). Se publica con
  **☁ Publicar destacados** y sale en la portada del catálogo.
- Al lado, **lo que más piden**, contado desde los pedidos reales enviados por WhatsApp
  (30 / 90 días / desde siempre), con pedidos y piezas por producto y un **＋** para subirlo
  a la portada. **↧ Usar los 12 más pedidos** arma la portada de un golpe.
- Debajo, **⚠ «Buscaron esto y no encontraron nada»**: los términos que dieron cero resultados,
  cada uno con dos botones — **＋ enseñar palabra** (el producto existe pero se llama de otro
  modo → crea la traducción) y **＋ dar de alta** (falta el producto → abre el alta). Es el
  dato más accionable de todo el catálogo. Y después, lo que más se busca en general.
- Requiere sesión (los datos de pedidos no son públicos). Al principio estará vacío: se
  llena solo conforme el catálogo se usa.

### 🏬 Sucursales y textos
- Nombre, WhatsApp, dirección, orden y visibilidad de cada sucursal, con enlaces para
  **probar el WhatsApp** y **ver la dirección en Google Maps** antes de publicar.
- Rótulos del catálogo (título de destacados, aviso de "sin precios").
- **Palabras que usa el cliente**: el diccionario de búsqueda (ver arriba). «si escribe esto →
  búscalo también como aquello».
- **Tipos de agrupación**: el catálogo de criterios (nombre, rótulo de columna, cuándo
  usarlo). Se pueden crear nuevos; no se deja borrar uno que alguna agrupación esté usando.
- Todo se publica junto con **☁ Publicar cambios**.

### Lo de siempre (clasificación)
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
- **Proveedores** (desde la ficha del producto): los **3,222** productos traen su
  proveedor del Excel maestro (`datos/productos_maestro.csv`, columna A del Excel
  aplicada a las filas siguientes) — **54 proveedores**. Dos acciones en bloque,
  porque un proveedor lo comparten decenas o cientos de productos:
  - **✎ Modificar para todos** — renombra el proveedor en **todos** los productos
    que lo comparten (ideal para corregir la captura del Excel: comas mal puestas,
    sufijos irregulares). Si escribes el nombre de otro proveedor existente, se
    **fusionan**. Reversible con Deshacer (`Ctrl+Z`).
  - **🚫 Mostrar en el Catálogo / 👁 Visible en el catálogo** — interruptor de
    publicación. **Arranca apagado en los 3,222.** Encendido, el proveedor aparece
    en la ficha del catálogo público para todos los productos de ese proveedor;
    apagado, el cliente final no lo ve. Ver la nota de privacidad abajo.
  - Marca **«Proveedor genérico o por confirmar»**: 90 productos que en el Excel
    no traen un proveedor real (88 dicen «PROVEEDOR EN GENERAL» y 2 la propia
    sucursal). Fíltralos desde el árbol para corregirlos.

> ⚠️ **Privacidad del proveedor.** La spec de **Fase 1** dice no publicar precio,
> existencia **ni proveedor**. Por eso el interruptor nace **apagado** y la
> protección vive en la **base de datos**, no sólo en la interfaz: la vista
> `catalogo_publico` entrega `proveedor` como `NULL` mientras `mostrar_proveedor`
> sea `false`. Como la anon key es pública y está desplegada, ésta es la única
> forma de que la lista de proveedores **no** sea descargable por cualquiera.
> El respaldo local (`data/productos.js`) sí trae los 54 proveedores porque es la
> copia **interna**; `assets/app.js` aplica el mismo filtro al usarlo, para que
> nunca publique lo que la base oculta.
- **Barra de filtros que se aparta**: la fila de búsqueda, proveedor y chips queda
  fija bajo el encabezado; al bajar entre los productos se retira para dejar toda
  la altura a la lista y **vuelve en cuanto empiezas a subir**. Nunca se esconde
  mientras escribes en ella (el atajo `/` la trae de vuelta sola).
- Atajos: `/` buscar · `Esc` cerrar/deseleccionar · `Ctrl+Z` deshacer · `←/→` navegar fichas.
- Autoprueba: abrir `clasificador.html?selftest=1` (franja PASS/FAIL al pie). Son **59
  comprobaciones**: reglas de sugerencia, exportadores, proveedores, claves de
  sincronización, altas y bajas de producto, y criterios, fotos y estructura de las
  agrupaciones. Las últimas 17 las añade `clasificador-plus.js` al final de la franja, porque
  se carga después de que corre la autoprueba principal.

### Trabajo en paralelo (dos o más personas a la vez)

**Qué ve el compañero, y cuándo.** No todo se comporta igual, y conviene saberlo antes
de repartir el trabajo:

| Lo que uno cambia | Cuándo lo ve el otro | Cómo |
|---|---|---|
| Clasificar un producto (categoría, medida, nombre, foto, marcas) | **en el momento** (~1 s) | Realtime |
| **Dar de alta** un producto | **en el momento** | Realtime (`INSERT`) |
| **Eliminar** un producto | **en el momento** | Realtime (`DELETE`) |
| Crear o editar una **agrupación** | **en el momento** | Realtime sobre `familias` |
| **Destacados**, **sucursales**, **textos**, **diccionario** | al pulsar **⟲ Traer del equipo** | aviso automático + recarga manual |

Los cuatro últimos se tratan aparte **a propósito**: son formularios que se llenan y se
publican a mano, así que recargarlos solos borraría lo que la persona está escribiendo.
Cuando alguien los cambia, aparece un aviso —*«Alguien cambió sucursales o ajustes»*— y
cada quien decide cuándo traerlos.

> ⚠️ **El tiempo real exige sesión.** RLS sólo emite eventos a `authenticated`. Sin iniciar
> sesión no llega nada en vivo, y el respaldo es un repaso por reloj cada 45 s.
>
> ⚠️ **Si dos tocan lo mismo, gana el último que guarda** — en silencio, salvo en el editor
> de agrupaciones, que sí avisa («Alguien más acaba de cambiar…») cuando alguien modifica
> justo la que tienes abierta. La regla práctica sigue siendo **repartirse por categoría**.

La otra mitad de la historia son las **tres capas de guardado**, y que la **fuente de verdad
compartida es Supabase**:

1. **localStorage** del navegador — tu avance, por máquina.
2. **Archivo local** `data/productos.js`/`.json` — se reescribe en tu disco con la
   *Conexión directa* (File System Access). Es una copia/respaldo, **no** el punto
   de encuentro entre las dos personas.
3. **Tabla `productos` de Supabase** — lo compartido. El catálogo público lee de aquí.

- **Subir (push) — automático:** inicia sesión **una vez** en *Guardar / Exportar →
  Sincronización en línea (Supabase)*. Con sesión activa (indicador **"● En línea ·
  0 pendientes"**), cada cambio se sube solo a Supabase. **Sin** sesión, tus cambios
  se quedan locales y **pendientes**: el otro no los recibe. Cada quien sube **sólo**
  las filas que realmente tocó, así que no puede pisar el trabajo del otro salvo que
  edite el **mismo** producto.
- **Bajar (pull) — botón "⟲ Traer del equipo":** el clasificador **no** leía en vivo
  de Supabase; para ver lo que el otro reclasificó desde su máquina, pulsa **"⟲ Traer
  del equipo"** (barra superior). Con la casilla **"auto"** activada (por defecto) lo
  hace solo cada ~45 s —pero nunca en medio de una selección, una subida o un modal
  abierto, para no moverte el piso—. Al abrir el clasificador también baja lo último
  del equipo. Tus cambios locales **siempre mandan encima**: un pull nunca pisa lo que
  tú acabas de clasificar, sólo trae lo del resto. La lectura es anónima: no requiere
  sesión (la sesión sólo hace falta para **subir**).
- **Verificación combinada:** el resultado de ambos junto se ve en el **catálogo
  público** (recargándolo), que siempre lee de Supabase.

**Flujo recomendado**
1. Ambos: iniciar sesión y confirmar **"● En línea · 0 pendientes"** al guardar.
2. Dividir por categoría, **sin traslape** (discos / perfiles). Las fotos también se
   comparten (van a Supabase Storage) y el otro las ve con "Traer del equipo".
3. Trabajar normal; los cambios suben solos y "auto" los baja en la otra máquina.
4. Al cerrar la sesión de trabajo, **una** persona corre `node sync-local.mjs` para
   volcar Supabase sobre `data/productos.js`/`.json`, y hace `git add/commit/push`.
   El otro hace `git pull`. Así el repositorio queda idéntico a lo que ve el público.

**Cuidados (conflictos)**
- **Mismo producto tocado por ambos** → gana el último que sube, en silencio. Evítalo
  manteniendo la división por categoría y no pescando los dos del mismo montón
  *POR CLASIFICAR* sobre los mismos códigos.
- **No mezcles a mano** `data/productos.js`/`.json` en git: cada archivo es la foto
  completa y chocan casi línea por línea. Trata Supabase como fuente de verdad y
  regenera esos archivos con `sync-local.mjs` (uno solo lo commitea).

## Llenado de fotos (operativa posterior)
Ver `fotos\LEEME.txt`. Resumen: guardar cada imagen en `fotos\` con el nombre por
código indicado en `..\datos\plantilla_fotos.csv` (`.webp/.jpg/.png`). Aparecen solas.

## Qué vive en Supabase (y ya no en el código)

| Tabla / vista | Qué guarda | Quién la edita |
|---|---|---|
| `productos` | los 3,222 + los que dé de alta el encargado | Clasificador → Productos |
| `familias` | qué códigos van juntos, con qué criterio y en qué subgrupos | Clasificador → Agrupaciones |
| `ajustes` | `destacados`, `textos_catalogo`, `criterios_agrupacion`, `sinonimos_busqueda` | Clasificador → Destacados / Sucursales y textos |
| `sucursales` | nombre, WhatsApp, dirección, orden, visibilidad | Clasificador → Sucursales y textos |
| `eventos_catalogo` | uso real del catálogo (ver / agregar / pedir / buscar) | lo escribe el catálogo público |
| `productos_populares` | vista: ranking de lo más pedido (30/90 días) | sólo lectura, con sesión |
| `busquedas_populares` | vista: qué busca la gente | sólo lectura, con sesión |

Migración: [`supabase/migrations/20260802_catalogo_editable_sin_codigo.sql`](../supabase/migrations/20260802_catalogo_editable_sin_codigo.sql).

**Permisos (RLS).** Sin sesión (`anon`) se puede **leer** sucursales, ajustes y agrupaciones
activas —son datos que el catálogo público necesita para pintarse— y **escribir sólo** en
`eventos_catalogo`. Nada más: `anon` no puede leer el historial de eventos ni el ranking de
pedidos (serían regalarle a la competencia qué se vende), ni tocar productos, agrupaciones o
ajustes.

⚠️ **Estar autenticado NO basta para escribir.** Hay que estar en la tabla `editores`. La
razón: el registro público de Supabase está abierto y la anon key es pública (va dentro del
JavaScript desplegado, por diseño), así que con la regla anterior —«cualquier usuario
autenticado puede todo»— **cualquiera en internet podía registrarse y quedar con permiso para
borrar productos o cambiar los WhatsApp de las sucursales**. Ahora todas las políticas de
escritura pasan por `public.es_editor()`, que comprueba el correo del token contra esa lista.

## Dar de alta a un trabajador

Lo que el trabajador necesita es **dos enlaces y una cuenta**. Nada que instalar.

1. **Autorízalo primero** (para que no exista ni un minuto una cuenta con permiso sin control):
   Supabase → *Table Editor* → tabla **`editores`** → *Insert row* → su **correo**. Da igual si
   su cuenta todavía no existe: la lista va por correo, no por id, precisamente para que el
   orden de los pasos no importe.
2. **Crea su usuario**: Supabase → *Authentication* → *Users* → *Add user*, marcando
   **Auto Confirm** (si no, tendrá que confirmar por correo). Dale la contraseña en persona.
3. **Pásale los dos enlaces**:
   - Catálogo (lo que ve el cliente): `https://catalogo-digital-aceros-penascal.vercel.app/`
   - Panel de edición: `https://catalogo-digital-aceros-penascal.vercel.app/clasificador.html`
4. Dile que entre a **«Guardar / Exportar» → iniciar sesión**, y que compruebe que arriba diga
   **«● En línea»**. Si dice **«⚠ Sin permiso para editar»**, le falta el paso 1.
5. Que lea la pestaña **«❓ Cómo se usa»**. Está escrita para alguien que no programa.

> **Cierra el registro público**: Supabase → *Authentication* → *Sign In / Providers* → Email →
> desactivar *«Allow new users to sign up»*. La lista `editores` ya protege la escritura, pero
> con el registro abierto cualquiera puede seguir creándose cuentas en tu proyecto.

**Todos los editores pueden todo** (incluido eliminar productos). No hay roles ni permisos
parciales: es un equipo pequeño y la trazabilidad la da la **Bitácora** más `updated_by`. Si
alguna vez hace falta separar «puede clasificar» de «puede borrar», el sitio donde hacerlo es
`es_editor()` — añadiéndole una columna de nivel a `editores`.

## Estructura
```
catalogo-web/
  index.html          catálogo público (prototipo)
  clasificador.html   panel de administración del catálogo (5 pestañas)
  manifest.webmanifest
  assets/   styles.css · app.js · clasificador.css · clasificador.js
            clasificador-plus.js  agrupaciones, destacados, sucursales y guía.
                                  Se carga DESPUÉS de clasificador.js y comparte
                                  su ámbito global (mismas utilidades y datos).
            logo-ap-oficial.jpg  logo oficial completo (azul marino + cuadro rojo óxido)
            logo-ap-marca.png    solo el monograma — encabezado e iconos
            og-cover-v2.jpg      vista previa al compartir el enlace (1200×630)
            og-cover.jpg         copia idéntica del anterior (nombre viejo, cacheado
                                 en Facebook; se puede borrar más adelante)
            icon-192 / 512 / maskable-512.png   iconos PWA
            logo-ap.jpg/.png     versión metalizada, ya NO se usa en el catálogo
                                 (sigue en clasificador.html)
  core/     store.js · catalogService.js · searchService.js · cartService.js
            familiaService.js   qué productos van juntos en una ficha y bajo qué criterio
            ajustesService.js   sucursales, textos y destacados (Supabase → respaldo config.js)
            metricsService.js   registro de uso real, sin datos personales
  data/     productos.js (app) · productos.json (import futuro)
            familias.json/.js   RESPALDO de las agrupaciones (la base manda; ver arriba)
            fotos-manifest.json qué fotos existen realmente en disco
  fotos/    imágenes por código (LEEME.txt)
```

## Pendiente / roadmap
- **Datos:** pase de IA fino para los "POR CLASIFICAR" + atributos/funcionamiento.
- **Backend Supabase:** stock por sucursal, precios y existencias (al conectar el software de
  tienda) — la tabla `inventario` ya está creada y vacía, esperando esa conexión.
- **Limpieza:** `index.html` ya no trae el botón "Admin" del prototipo (el clasificador hace
  ese trabajo de verdad), pero `state.edit` y `toggleAdminUI()` siguen en `app.js`/`ui.js`
  como código muerto: se pueden quitar.
- **Categorías duplicadas por acentos**: hay pares que son el mismo concepto escrito distinto
  ("Tornilleria y fijacion" / "Tornillería y fijación"). Se fusionan desde el árbol del
  clasificador (✎ Renombrar con el nombre del otro).
