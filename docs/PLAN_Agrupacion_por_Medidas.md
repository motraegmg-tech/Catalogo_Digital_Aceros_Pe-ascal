# Plan — Agrupar productos por medida (fichas de familia)

> Estado: **programado y funcionando en el catálogo (2026-07-31).**
> Las cuatro fases están hechas. Ver [«Lo que quedó programado»](#lo-que-quedó-programado)
> al final y la sección *Fichas de familia* de [`catalogo-web/README.md`](../catalogo-web/README.md).

## El problema

Hoy `Perfiles Macizos` muestra **174 fichas**: una por cada ángulo, cada solera, cada
redondo. El cliente ve veinte veces "SOLERA" cambiando solo el número. Buscar la
medida que necesita es tarea de paciencia.

## Lo que se propone

Que una familia de productos que solo se diferencian por la medida se presente como
**una sola ficha**, y que la medida se elija dentro.

### Cómo quedaría la navegación

```
HOY                                    PROPUESTA
────────────────────────────────       ─────────────────────────────────
Perfiles Macizos                       Perfiles Macizos
├ SOLERA 1" X 1/8"                     ├ [foto] Soleras         32 medidas
├ SOLERA 1" X 3/16"                    ├ [foto] Ángulos         14 medidas
├ SOLERA 1 1/4" X 1/8"                 ├ [foto] Redondos        11 medidas
├ SOLERA 1 1/2" X 1/4"                 ├ [foto] Cuadrados        9 medidas
├ … 28 más …                           ├ [foto] Vigas IPR       13 medidas
├ ANGULO 1/2" X 1/8"                   └ [foto] Barras           6 medidas
├ ANGULO 3/4" X 1/8"
└ … 160 fichas en total …              6 fichas en vez de 174
```

### Cómo se vería la ficha de familia

```
┌───────────────────────────────────────────────────────────┐
│  [ foto ]   SOLERA                                        │
│             Perfiles Macizos › Solera · 32 medidas        │
├───────────────────────────────────────────────────────────┤
│  Elige medida y cantidad                                  │
│                                                           │
│   MEDIDA              CÓDIGO         CANTIDAD             │
│   1" X 1/8"           SOL25X3        [ − ] 0 [ + ]        │
│   1" X 3/16"          SOL25X5        [ − ] 2 [ + ]        │
│   1 1/4" X 1/8"       SOL32X3        [ − ] 0 [ + ]        │
│   1 1/2" X 1/4"       SOL38X6        [ − ] 1 [ + ]        │
│   … 28 más …                          ⌄ ver todas         │
│                                                           │
│              [ Agregar 3 productos al pedido ]            │
└───────────────────────────────────────────────────────────┘
```

Con buscador dentro de la familia cuando pase de ~15 medidas.

## Dónde agrupa y dónde no (decidido por Gonzalo, 2026-07-31)

La agrupación **no sustituye** la vista actual: convive con ella.

| Dónde está el cliente | Qué ve |
|---|---|
| **Todas las categorías** | **Todas las fichas, una por producto** — igual que hoy, sin agrupar |
| Dentro de una categoría | Las familias aprobadas como ficha única, más los productos sueltos |
| Buscando algo | Resultados producto por producto (la búsqueda no agrupa) |

Así la vista general sigue siendo el catálogo completo — útil para quien explora o
compara — y el agrupamiento solo entra donde de verdad estorba el ruido: al bajar a
una categoría con veinte soleras seguidas.

Además, **solo se agrupa lo aprobado**. Una familia sin aprobar sigue mostrando sus
productos sueltos, así que se puede encender de a poco.

## Lo que NO cambia (importante)

**Cada medida sigue siendo su propio producto, con su propio código.** La agrupación
es solo de **presentación**. Eso significa:

- El carrito no cambia: cada medida entra como su propia línea, con su código.
- El mensaje de WhatsApp sigue igual de preciso.
- La clasificación, las fotos y Supabase no se tocan.
- Si algo sale mal, se apaga la vista agrupada y todo vuelve a como está hoy.

Es la diferencia entre *reorganizar el catálogo* y *reorganizar el escaparate*.
Esto es lo segundo, que es mucho menos arriesgado.

## Cuánto agrupa realmente (medido sobre los datos de hoy)

| | |
|---|---|
| Productos clasificados | 3,150 |
| Familias con 2 o más productos | **432** → cubren **1,759 productos** |
| Productos que quedan sueltos | 1,391 |
| **Fichas totales tras agrupar** | **1,823** (−42%) |

Familias más grandes detectadas: Solera (32), Broca fierro Irwin (28), Remache POP (26),
PTR (26), Tornillo hex. galvanizado (22), Disco de corte (20), Tubo negro (19).

## Cómo se decide qué va junto

Clave de familia = **categoría + subcategoría + nombre sin la medida**.

Al nombre se le quitan: la medida (`4 1/2"`, `230 X 280 mm`), los códigos entre
paréntesis y las palabras de relleno (`DE`, `P/`). Lo que queda es la familia:

```
SOLERA 1" X 1/8"      →  SOLERA
SOLERA 1 1/2" X 1/4"  →  SOLERA
```

**Esto es una sugerencia, no una verdad.** El agrupador se equivocará: juntará cosas
que no van juntas y separará cosas que sí. Por eso la propuesta es tratarlo igual que
la clasificación: **el sistema sugiere, tú apruebas en el clasificador**. Una familia
sin aprobar no se muestra agrupada; el catálogo sigue mostrando sus productos sueltos.

Esto además hace la migración segura: se puede activar familia por familia, empezando
por Perfiles Macizos, y ver cómo queda antes de seguir.

## Riesgos y cómo se atienden

| Riesgo | Cómo se atiende |
|---|---|
| Agrupa cosas distintas (dos marcas, dos materiales) | Aprobación manual antes de publicar |
| Productos de la familia sin medida | No se agrupan; quedan como ficha suelta |
| El cliente ya no encuentra por búsqueda directa | La búsqueda sigue indexando cada producto; si el resultado es una medida, se abre su familia con esa fila resaltada |
| La foto de la familia no representa a todas | Se elige una foto de portada por familia en el clasificador |
| SEO / enlaces existentes | Cada producto conserva su URL; se redirige a la familia |

## Fases propuestas

1. ✅ **Agrupador + revisión** — pantalla para aprobar, renombrar o romper las familias
   sugeridas, sin tocar el catálogo público.
2. ✅ **Ficha de familia en el catálogo** — activada solo para las familias aprobadas.
3. ✅ **Carrito multi-medida** — agregar varias medidas de una vez.
4. ✅ **Extender al resto de categorías** — 173 fichas en 12 de las 14 categorías.

## Decidido — listo para programar (2026-07-31)

Gonzalo revisó las 181 propuestas: **174 aprobadas**, que cubren **1,583 productos**.
Navegando por categoría, el catálogo pasa de 3,150 a **1,741 fichas**. Las decisiones
quedaron en `datos/familias_aprobadas.json`.

| Decisión | Qué se hace |
|---|---|
| Ficha que abarca dos categorías | Se muestra completa **solo en su categoría principal** (donde tiene más productos). Los cruces son marginales — Brocas es 61 en Ferretería contra 2 en Herramienta eléctrica — así que casi no esconde nada. |
| Puntas | **Separadas**: "Puntas ornamentales" (48, Fierro Vaciado) y "Puntas montadas para desbaste" (5, Abrasivos). Mismo nombre, productos y compradores distintos. |
| Las 7 sin marcar | **Descartadas.** Sus 83 productos se siguen mostrando sueltos. Entre ellas iban "Chapas y cerraduras" y "Candados" sin marca, que eran los sobrantes sin marca reconocida. |

## Las cuatro preguntas abiertas — resueltas

| Pregunta | Cómo quedó |
|---|---|
| **Nivel de agrupación** | Por **familia de nombre**, no por subcategoría. En Perfiles Macizos da justo lo que pediste (Ángulos, Soleras, Redondos…) y en Ferretería, que tiene 906 productos de todo tipo, sigue teniendo sentido en vez de una ficha gigante. |
| **Familias de 2 productos** | Se **proponen** a partir de 3. Una ya aprobada que quede en 2 (por el chip de subcategoría o porque un producto salió del catálogo) sigue mostrándose como ficha; con 1 vuelve a ser tarjeta suelta. |
| **Portada de la familia** | **Automática**: la primera medida que sí tiene foto; si ninguna la tiene, la de en medio. Así la ficha nunca sale con el marcador "Sin foto" habiendo una foto disponible dentro. |
| **Nombre de la familia** | El **nombre limpio automático** ("SOLERA") o el de la regla ("Discos", "Brocas Urrea"). Se puede cambiar a mano en `datos/familias_aprobadas.json` sin tocar código. |

## Lo que quedó programado

**Lo que ve el cliente**

- La grilla de una categoría muestra **fichas de familia** — tarjeta con sello rojo
  («14 productos»), cuántas medidas hay para elegir, los subgrupos que trae dentro y el
  botón **Elegir medidas**.
- La **ficha** abre a lo ancho: portada, tabla de medidas con código y contador por fila,
  y las filas elegidas resaltadas. Se abre con 12 medidas por subgrupo y un
  «Ver las 20 restantes»; arriba de 15 medidas trae su **buscador interno**.
- El botón del pie dice **«Agregar 3 productos al pedido»** y manda **todas las medidas
  elegidas de una vez**, cada una como su propia línea con su código.
- **Todas las categorías** y la **búsqueda** siguen mostrando producto por producto.

**Cómo está armado**

| Pieza | Qué hace |
|---|---|
| `pipeline/generar_familias_catalogo.mjs` | Cruza propuestas + aprobadas + catálogo → `catalogo-web/data/familias.json` |
| `catalogo-web/core/familiaService.js` | Resuelve códigos contra el catálogo cargado y ordena las medidas |
| `catalogo-web/assets/ui.js` | `filteredEntries()` decide qué se agrupa; `buildFichaFamilia()` pinta la tabla |
| `catalogo-web/core/cartService.js` | `addManyToCartLogic()` — varias medidas de un golpe |

**Números de hoy**

| | |
|---|---|
| Fichas de familia publicadas | **173** en 12 de las 14 categorías |
| Productos que cubren | **1,576** |
| Navegando por categoría | 3,222 productos → **1,831 tarjetas** |
| Perfiles Macizos | 148 productos → **53 tarjetas** (12 de familia; Soleras es 1 en vez de 32) |

**Dos cosas que conviene tener presentes**

1. **Hay que regenerar `familias.json` cuando cambie `productos.json`.** Solo entra a una
   ficha lo que siga publicado y clasificado — al conectar esto se encontraron 7 códigos
   aprobados que ya habían vuelto a "POR CLASIFICAR" y estaban colgando de una ficha.
2. **Los cruces entre categorías se muestran, no se esconden.** El plan decía que una
   familia se ve completa solo en su categoría principal; sus pocos productos de otra
   categoría siguen apareciendo ahí como tarjetas sueltas, así no desaparece nada de la
   categoría que el cliente está viendo. Son 12 productos de 3,222, y nunca coinciden en
   la misma pantalla.
