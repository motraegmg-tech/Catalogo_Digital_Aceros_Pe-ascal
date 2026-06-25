# Catálogo Comercial Digital · Aceros Peñascal

> Proyecto de **MOTRAE** para Aceros Peñascal. Convierte su catálogo de materiales (hoy disperso) en un **catálogo digital navegable** con cotización directa por WhatsApp por sucursal, sobre una base de datos central como fuente única de verdad.
> **Estado:** prototipo PWA funcional verificado · pendiente el build de producción (Supabase + Next.js).

---

> 🤖 **Para Claude / agentes de IA — léeme primero.**
> Este README es el contexto completo del proyecto y basta para trabajar aunque el repo esté en otra máquina o carpeta. Orden de lectura recomendado:
> 1. Este `README.md` (panorama, alcance, decisiones, estado).
> 2. [`MOTRAE_AcerosPenascal_CatalogoDigital_Requerimientos.md`](MOTRAE_AcerosPenascal_CatalogoDigital_Requerimientos.md) — requerimientos detallados del cliente (la **spec**).
> 3. [`Taxonomia_Catalogo_AcerosPenascal.md`](Taxonomia_Catalogo_AcerosPenascal.md) — categorías y subcategorías.
> 4. [`catalogo-web/README.md`](catalogo-web/README.md) — cómo correr el prototipo.
> Empieza SIEMPRE las respuestas llamando al CEO por su nombre: **Gonzalo**.

---

## 🎯 Qué es

Un **Ecosistema de Catálogo Comercial Digital** (Fase 1): catálogo navegable por categorías, búsqueda inteligente, ficha técnica por producto y **carrito que envía la cotización al WhatsApp de la sucursal elegida**. No es "subir productos a una app": es una **plataforma centralizada de información comercial** sobre una sola base de datos, entregada **"integration-ready"** para conectarse después con el software de punto de venta del cliente.

## 👤 Cliente

| Campo | Dato |
|---|---|
| Empresa | **Aceros Peñascal** (acero, materiales metálicos, ferretería y construcción) |
| Propietarios | Sra. Neny · Sr. Edgar |
| Ubicación | Xalapa, Veracruz · México · >20 años de operación |
| Operación | **5 sucursales**, cada una con stock propio y su WhatsApp |

**Sucursales y WhatsApp** (el carrito redirige al número de la sucursal elegida):

| Sucursal | WhatsApp |
|---|---|
| Matriz | 52 228 317 0708 |
| Sucursal Bodega | 52 228 860 4502 |
| Las Trancas | 52 228 835 7198 |
| Coatepec | 52 228 839 8812 |
| Naolinco | 52 228 194 7245 |

## 📌 Qué pide el cliente

Catálogo **completo, claro y profesional**, fácil de usar para cualquier persona (incluyendo clientes mayores), con ficha estandarizada (foto, descripción, especificaciones, código) y **cotización directa por WhatsApp a la sucursal correcta**; herramienta interna para los **dueños** (qué se ve / cotiza / vende); y una base **ordenada y escalable** que más adelante conecte con su sistema de punto de venta para precios y stock en vivo.

## ✅ Alcance / ⛔ Fuera de alcance (Fase 1)

> **Regla de oro:** todo compromiso se limita al **Catálogo Comercial Digital**. **No** se promete la plataforma SaaS completa ni la consultoría DELTA OPS a este cliente.

**Dentro:** base de datos central · catálogo navegable (PWA) · fichas técnicas · integración WhatsApp por sucursal · sistema visual · renderizados/mockups · estructuración integration-ready, documentación, capacitación y panel de administración.

**Fuera (fases futuras, por contrato aparte):** sincronización en vivo de **precios y stock** con el POS del cliente · web transaccional · CRM · inventario en tiempo real · geolocalización/envíos · IA integrada · hosting/dominios.

## 🧭 Decisiones clave del build (rigen cómo se construye)

1. **Catálogo público mínimo y limpio:** cada producto muestra **código + descripción/funcionamiento (con especificaciones: largo, calibre, material…) + foto + botón Cotizar**. **Precio, existencia y proveedor quedan internos/ocultos** hasta conectar el software del cliente.
2. **POS = sistema propio/a medida** (lo hacen ingenieros externos del cliente). MOTRAE entrega un **conector genérico desacoplado** (Edge Function); el sync de precio/stock es **fase futura**.
3. **Por etapas:** primero el catálogo, después el sync. Arquitectura nace **"integration-ready"**.
4. **5 sucursales con WhatsApp propio.** Carrito → WhatsApp de la sucursal con el detalle de lo cotizado.
5. **Panel para dueños** con estadísticas (más visto / cotizado / vendido); ahí vive el **editor inline avanzado**.
6. **Fotos en operativa posterior** (3,000+ productos): capacidad de llenado **por código** (placeholders ahora, carga progresiva después).
7. **Editor inline avanzado** (admin): edición en vivo con persistencia en BD, campos estructurados, apoyo de IA, validación, control por rol (RLS) y bitácora; permite **alta/baja** de productos.

## 🗂️ Datos y taxonomía

- Catálogo maestro: **3,222 productos**, **53 proveedores** (Excel en `CATALOGO PROD. PEÑASCAL/`). El maestro **no trae precio ni categoría**; cada producto está bajo un solo proveedor (correlación "varios surten lo mismo" es **por tipo/equivalencia**).
- Taxonomía actual: **14 categorías** (número **fluido, puede cambiar**) en 2 niveles → ver [`Taxonomia_Catalogo_AcerosPenascal.md`](Taxonomia_Catalogo_AcerosPenascal.md).
- Auto-clasificación ~84.5%; el resto (forja ornamental, herrajes) se afina con IA + revisión comercial.

## 🧱 Stack técnico

| | |
|---|---|
| **Destino (producción)** | **Supabase** (Postgres + RLS + Auth + Storage + Edge Functions) + **Next.js** (PWA) |
| **Prototipo actual** | PWA *vanilla* autocontenida (HTML/CSS/JS), corre sin servidor ni internet |
| **Pipeline de datos** | Scripts PowerShell + Node (`datos/_scripts/`, `pipeline/`) |

## 📁 Estructura del repositorio

```
Catalogo_Digital_Repository/
├─ README.md                                            ← este archivo (contexto del proyecto)
├─ CLAUDE.md                                            ← carga automática para Claude Code
├─ MOTRAE_AcerosPenascal_CatalogoDigital_Requerimientos.md  ← SPEC: requerimientos del cliente
├─ Taxonomia_Catalogo_AcerosPenascal.md                ← 14 categorías + subcategorías (fluida)
├─ CATALOGO PROD. PEÑASCAL/                             ← Excel maestro (3,222 productos)
├─ CATALOGO PROVEEDORES ACEROS PEÑAS 15 06 2026/        ← PDFs de referencia (Ternium, TYASA, DMT, Papalotes…)
├─ catalogo-web/                                        ← PROTOTIPO PWA funcional (abrir index.html)
│  ├─ index.html · manifest.webmanifest
│  ├─ assets/ (app.js, styles.css, logo)
│  ├─ data/ (productos.js, productos.json)             ← datos del catálogo
│  └─ fotos/ (LEEME.txt)                                ← fotos por código (placeholders)
├─ datos/                                               ← pipeline de datos
│  ├─ productos_maestro.csv · catalogo_categorizado.csv · por_clasificar.csv
│  ├─ plantilla_fotos.csv · Correlacion_Proveedores_AcerosPenascal.xlsx
│  └─ _scripts/ (build_data.ps1, categorizar_v1.ps1)
└─ pipeline/                                            ← enriquecimiento por IA (Batch API) — EN PAUSA
   └─ enrich.mjs · package.json · .env
```

> El **entregable formal** del cliente — `MOTRAE_AcerosPenascal_CatalogoDigital_Requerimientos.docx`, el **SOW** y el briefing legal — vive en la carpeta MOTRAE del cliente (`…/03 Catalogo Digital/` y subcarpetas), **fuera de este repo**.

## 🚦 Estado actual y pendientes

**Hecho:** datos maestros limpios (3,222), categorización y correlación, taxonomía, y **prototipo PWA funcional verificado** (navegación, búsqueda, ficha, carrito→WhatsApp, modo Admin demo, paleta industrial, placeholders de foto).

**Pendiente del cliente para arrancar producción:** lista de **precios** · **fotos** utilizables · **hosting** (Supabase + Vercel) · **cómo expone los datos su POS** (para el conector y el sync). *(Sucursales y WhatsApp ya entregados.)*

**Pendiente de MOTRAE:** build de producción en Supabase + Next.js; clasificar los ~498 "POR CLASIFICAR" (mayoría forja ornamental); operativa de carga de fotos por código.

## 🛠️ Cómo trabajar en este repo

- **Correr el prototipo:** doble clic en `catalogo-web/index.html` (sin servidor) — o `npx serve` en `catalogo-web/` para PWA instalable. Detalle en [`catalogo-web/README.md`](catalogo-web/README.md).
- **Paleta industrial del catálogo PREVALECE** sobre la marca MOTRAE para este producto (es la cara digital de Aceros Peñascal). Ver §10 de la spec.
- **Nunca** exponer al público precio, existencia ni proveedor en Fase 1.
- **Nota técnica:** `ConvertTo-Json` de PowerShell 5.1 colapsa arreglos de 1 elemento → en el JS los datos se coercen con `asArray()`. Tenerlo en cuenta al regenerar `data/productos.js`.
- **Verificación headless:** se usa `agent-browser` para capturas de prueba del prototipo.

## 🎨 Identidad visual

| Rol | Color |
|---|---|
| Base | Grises acero (blanco → negro) |
| Acento de marca | Rojo `#921A2A` (color oficial del logo AP) |
| Contorno de fichas | Aqua intenso `#0E7E8C` |
| Etiquetas | Verde zintro `#4E9A51` |

Logo real AP = azul marino + rojo carmín. Tipografía y guía de uso multicanal (WhatsApp, móvil, impreso, pantalla) en la spec.

## 📄 Documentos y contacto

- **Spec / requerimientos:** [`MOTRAE_AcerosPenascal_CatalogoDigital_Requerimientos.md`](MOTRAE_AcerosPenascal_CatalogoDigital_Requerimientos.md) (en este repo) · `.docx` en la carpeta del cliente.
- **Contrato / SOW:** `MOTRAE_SOW_CatalogoDigital_AcerosPenascal` — Fase 1, $50,000 MXN + IVA, 25–35 días hábiles, pago 50/50 (carpeta del cliente).
- **Proveedor:** MOTRAE México · motrae.gmg@gmail.com · 228 353 6911.
- **Equipo:** Gonzalo Jácome (Producto/Tecnología) · Mauricio Flores (Comercial) · Gerson Rivera (Operaciones).

---

*MOTRAE · Innovation already in motion · Confidencial · Junio 2026 · Xalapa, Veracruz · México*
