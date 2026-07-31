# Plan — Agrupar productos por medida (fichas de familia)

> Estado: **propuesta, pendiente de visto bueno de Gonzalo.** No se ha programado nada.

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

1. **Agrupador + revisión** — el clasificador muestra las 432 familias sugeridas para
   aprobar, renombrar o romper. Sin tocar el catálogo público.
2. **Ficha de familia en el catálogo** — activada solo para las familias aprobadas.
3. **Carrito multi-medida** — agregar varias medidas de una vez.
4. **Extender al resto de categorías**, viendo resultados entre fase y fase.

## Lo que necesito que decidas

1. **Nivel de agrupación.** Dijiste "que aparezcan las subclasificaciones de Perfiles
   Macizos". Eso funciona ahí porque sus subcategorías (Ángulos, Soleras…) ya son
   familias. Pero `Ferretería › Ferretería` tiene 906 productos de todo tipo: agrupar
   por subcategoría daría una ficha gigante. **Propongo agrupar por familia de nombre,
   no por subcategoría** — en Perfiles Macizos el resultado es el que describes, y en
   Ferretería sigue teniendo sentido.

2. **Familias de 2 productos.** ¿Vale la pena una ficha de familia para dos medidas, o
   a partir de 3? (Propongo 3: con dos, agrupar estorba más de lo que ayuda.)

3. **Portada de la familia.** ¿Foto del producto de medida intermedia (automático), o
   la eliges tú en el clasificador?

4. **Nombre de la familia.** ¿El nombre limpio automático ("SOLERA"), o lo escribes tú?
