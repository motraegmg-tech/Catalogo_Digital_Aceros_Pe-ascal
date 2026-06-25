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
