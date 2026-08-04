# CLAUDE.md — Catálogo Comercial Digital · Aceros Peñascal

**Lee primero [`README.md`](README.md): es el contexto completo del proyecto.** Luego la spec [`MOTRAE_AcerosPenascal_CatalogoDigital_Requerimientos.md`](MOTRAE_AcerosPenascal_CatalogoDigital_Requerimientos.md) y la [`Taxonomia_Catalogo_AcerosPenascal.md`](Taxonomia_Catalogo_AcerosPenascal.md).

## Lo esencial para no equivocarse
- Proyecto de **MOTRAE** para **Aceros Peñascal** (Xalapa). CEO de MOTRAE: **Gonzalo** — empieza tus respuestas llamándolo por su nombre.
- Alcance = **solo el Catálogo Comercial Digital** (Fase 1). No prometer SaaS completo ni DELTA OPS.
- Catálogo público = **código + descripción + especificaciones + foto + botón Cotizar**. **Nunca** mostrar al público precio, existencia ni proveedor en Fase 1.
- **Carrito → WhatsApp de la sucursal elegida** (5 sucursales con número propio).
- **3,222 productos**, **14 categorías** (número fluido). Fotos por código en operativa posterior (placeholders ahora).
- Destino: **Supabase + Next.js (PWA)**. Hoy hay un **prototipo PWA funcional** en `catalogo-web/` (corre sin servidor).
- La **paleta industrial** del catálogo prevalece sobre la marca MOTRAE para este producto.

## Notas técnicas
- `ConvertTo-Json` (PowerShell 5.1) colapsa arreglos de 1 elemento → en el JS se coercen con `asArray()`.
- Correr prototipo: doble clic en `catalogo-web/index.html`, o `npx serve` para PWA instalable.
- **Clasificador = panel de administración**: `catalogo-web/clasificador.html` (doble clic), en 5 pestañas — **Productos** (alta/baja/edición y foto), **Agrupaciones** (fichas de familia y su criterio), **Destacados** (portada + lo más pedido real), **Sucursales y textos**, **Cómo se usa**. Avance en localStorage (`ap_clasificador_v1`), autoprueba con `?selftest=1` (97 comprobaciones). Su barra superior va en **rojo óxido** (`--oxido`) para no confundirlo con el catálogo del cliente. Detalles en `catalogo-web/README.md`.
- **Retirar del catálogo = marca de gestión `obsoleto`** («Productos obsoletos», columna `etiquetas`). Lo marcado sale de todas las listas, del conteo de arriba y de `catalogo_publico`, pero **conserva su categoría** y vuelve quitándole la marca. La categoría `Productos Descontinuados / Ocultos` quedó **jubilada**: el disparador `ignorar_categoria_jubilada` impide que un clasificador con deltas viejos la resucite.
- **El código de un producto se corrige desde la ficha.** Es un renombrado real (`update productos set codigo=… where id=…`), no una baja+alta: el `id` no cambia, así que conserva foto y clasificación, y las agrupaciones que lo mencionan se reescriben solas. Vive en `WORK.renombres` y sube antes que el resto del push.
- **El correo del autorizador (`ajustes.correo_autorizador`) no lo puede escribir nadie desde la app.** Es la llave del alta de cuentas. Además de estar en sólo lectura en el panel, hay **políticas RLS restrictivas** (`solo_motrae_escribe_autorizador_*`) que niegan INSERT/UPDATE/DELETE de esa clave a `authenticated` y `anon`; leerla sí se puede. Se cambia con acceso directo a la base (o service_role, que es como entra la Edge Function `acceso`).
- **La única marca de gestión del panel es `obsoleto`.** `sin-foto`, `sin-conocimiento` y `proveedor-por-revisar` salieron de la interfaz el 2026-08-04 (`ETIQUETAS_RETIRADAS`), pero **el dato se conserva**: los scripts de `pipeline/` leen `sin-foto` para saber a qué productos les falta imagen.
- **La bitácora es compartida** (tabla `bitacora`, 60 días, purga con `purgar_bitacora()`). Firma con el correo de la sesión; sin sesión el cambio ni sube ni se atribuye.
- **Agrupar es la vista por defecto** del catálogo público, **también buscando** (decisión de Gonzalo, 2026-08-04). Buscar «solera» da UNA tarjeta, no treinta filas casi iguales. Diferencia clave: buscando, la ficha muestra **sólo los productos que coincidieron** — con «solera 1/8» enseñar las 32 medidas sería deshacerle al cliente el filtro que acaba de hacer. Y si sólo coincide un producto de la familia (escribió su código o su medida exacta), sale **suelto**: eso es pedir algo específico. Un producto sin agrupación sale suelto siempre.
- **Todo el catálogo se edita sin código.** Lo que antes vivía en archivos vive en Supabase: `familias` (agrupaciones), `ajustes` (destacados, textos, criterios), `sucursales`. El destinatario es el encargado de Aceros Peñascal, que **no programa**: al tocar el clasificador, la prioridad es que se entienda sin explicación previa. Escribir exige sesión (RLS); leer no.
- **`eventos_catalogo`** registra el uso real del catálogo (ver / agregar / pedir / buscar) para saber qué se pide más. **Sólo códigos**: ningún dato del visitante. Sigue valiendo la regla de Fase 1 — nunca precio, existencia ni proveedor en público.

## Contexto de la empresa (MOTRAE)
Este proyecto lo desarrolla **MOTRAE** para el cliente. El contexto completo de la empresa (qué es, modelo de negocio, marca, tono) se importa automáticamente a continuación:

@docs/MOTRAE_EMPRESA.md
