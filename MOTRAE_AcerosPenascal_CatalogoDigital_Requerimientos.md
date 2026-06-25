<div align="center">

**M O T R A E**

**DOCUMENTO DE PROYECTO · CLIENTE**

# Lo que pide Aceros Peñascal de su Catálogo Digital

**Requerimientos, alcance y decisiones del Ecosistema de Catálogo Comercial Digital**

*Ingeniería estratégica · Optimización inteligente · Innovación funcional*

</div>

---

> **Xalapa, Veracruz · México · Junio 2026  |  Confidencial**
> MOTRAE · Aceros Peñascal · Catálogo Comercial Digital (Fase 1)

---

## Ficha rápida

| Campo | Dato |
|---|---|
| **Cliente** | Aceros Peñascal |
| **Propietarios** | Sra. Neny · Sr. Edgar |
| **Sede y operación** | Xalapa, Veracruz · 5 sucursales |
| **Giro** | Comercialización de acero, materiales metálicos, ferretería y construcción |
| **Proyecto** | Ecosistema de Catálogo Comercial Digital |
| **Alcance aceptado** | **Únicamente** el Catálogo Comercial Digital (Fase 1) |
| **Documento gobernante** | SOW `MOTRAE_SOW_CatalogoDigital_AcerosPenascal` |
| **Inversión** | $50,000 MXN + IVA |
| **Plazo** | 25 a 35 días hábiles |
| **Forma de pago** | 50% al inicio · 50% a la entrega final |
| **Stack destino** | Supabase (Postgres + RLS + Auth + Storage + Edge Functions) + Next.js PWA |
| **Catálogo base** | 3,222 productos · 53 proveedores · 14 categorías |
| **Estado** | Prototipo PWA funcional verificado; pendiente de build de producción |

---

## Índice

1. [Resumen ejecutivo](#1-resumen-ejecutivo)
2. [Quién es Aceros Peñascal](#2-quién-es-aceros-peñascal)
3. [Qué pide el cliente: la necesidad](#3-qué-pide-el-cliente-la-necesidad)
4. [Alcance aceptado y sus límites](#4-alcance-aceptado-y-sus-límites)
5. [El producto: Ecosistema de Catálogo Comercial Digital](#5-el-producto-ecosistema-de-catálogo-comercial-digital)
6. [Decisiones clave del cliente](#6-decisiones-clave-del-cliente)
7. [Estructura del catálogo: datos y taxonomía](#7-estructura-del-catálogo-datos-y-taxonomía)
8. [Requisitos funcionales](#8-requisitos-funcionales)
9. [Requisitos Extras](#9-requisitos-extras)
10. [Identidad visual del catálogo](#10-identidad-visual-del-catálogo)
11. [Entregables, fases y cronograma](#11-entregables-fases-y-cronograma)
12. [Condiciones comerciales](#12-condiciones-comerciales)
13. [Pendientes del cliente para el build](#13-pendientes-del-cliente-para-el-build)
14. [Fuera de alcance: fases futuras](#14-fuera-de-alcance-fases-futuras)
15. [Datos del proyecto y contacto](#15-datos-del-proyecto-y-contacto)

---

## 1. Resumen ejecutivo

Aceros Peñascal pidió a MOTRAE **transformar su catálogo de materiales —hoy disperso, sin imágenes ni descripciones estandarizadas— en un catálogo comercial digital moderno, navegable y centralizado**, que sea su nueva carta de presentación ante cada cliente y la base ordenada para crecer después hacia ventas en línea e integración con su operación.

De la propuesta integral que MOTRAE presentó (plataforma SaaS + DELTA OPS), **el cliente aceptó únicamente el Catálogo Comercial Digital**. Ese es el alcance contratado y el objeto de este documento.

El proyecto no consiste solo en "subir productos a una app": consiste en construir una **plataforma centralizada de información comercial** sobre una **única base de datos de productos como fuente única de verdad**, desde la cual se gobierna la consulta de materiales en los canales donde Aceros Peñascal atiende a sus clientes (catálogo navegable + WhatsApp). La arquitectura se entrega **"integration-ready"**: lista para conectarse, en una fase futura, con el software de punto de venta que el cliente desarrolla por separado.

> **En una frase:** un catálogo digital impecable, fácil de usar, con cotización directa por WhatsApp por sucursal, preparado para escalar — sin prometer todavía la sincronización en vivo de precios y stock.

---

## 2. Quién es Aceros Peñascal

| Campo | Dato |
|---|---|
| **Empresa** | Aceros Peñascal |
| **Propietarios** | Sra. Neny y Sr. Edgar |
| **Ubicación** | Xalapa, Veracruz · México |
| **Sector** | Acero, materiales metálicos, ferretería y construcción |
| **Operación** | 5 sucursales con stock propio por punto |
| **Trayectoria** | Más de 20 años de operación; reputación y liderazgo ganados cliente a cliente |

**Sus 5 sucursales** (cada una con stock distinto y su propio canal de WhatsApp):

| # | Sucursal | WhatsApp |
|---|---|---|
| 1 | Matriz | 52 228 317 0708 |
| 2 | Sucursal Bodega | 52 228 860 4502 |
| 3 | Las Trancas | 52 228 835 7198 |
| 4 | Coatepec | 52 228 839 8812 |
| 5 | Naolinco | 52 228 194 7245 |

Es una empresa consolidada, con producto físico de calidad y un equipo de ventas que atiende en mostrador, en campo/obra y por teléfono. Su reto no es el producto: es la **presentación y la información** de ese producto en el mundo digital.

---

## 3. Qué pide el cliente: la necesidad

Aceros Peñascal identificó —y MOTRAE confirmó en campo— que su información comercial está fragmentada y no aprovecha su fortaleza real:

- Catálogo de materiales **sin sistema digital unificado**: sin fotografías, sin descripciones técnicas estandarizadas, sin usos esperados de cada producto.
- Información de producto **dispersa entre sucursales, bodegas y vendedores**, sin una fuente única de verdad.
- Consulta de productos **artesanal y heterogénea**: cada vendedor responde a su manera, sin material visual de respaldo.
- Sin una **carta de presentación digital** a la altura de su trayectoria de más de 20 años.

**Lo que el cliente quiere obtener:**

1. Un catálogo digital **completo, claro y profesional** de su portafolio de materiales.
2. Una experiencia **sencilla, intuitiva y sin fricción** — usable por cualquier persona, incluyendo clientes mayores o con poca experiencia digital.
3. Que cada producto tenga **ficha técnica estandarizada** (foto, descripción, especificaciones, código) y un **botón de cotización directa** al equipo comercial.
4. Que la cotización **llegue por WhatsApp a la sucursal correcta**, respetando que cada punto tiene su propio inventario y su propio número.
5. Una herramienta interna para los **dueños** que muestre el comportamiento del catálogo (qué se ve, qué se cotiza, qué se vende).
6. Una base **ordenada y escalable** que más adelante se conecte con su sistema de punto de venta y habilite precios y stock en vivo.

---

## 4. Alcance aceptado y sus límites

> **Regla de oro de este cliente:** todo el material y todo compromiso se limitan al **Catálogo Comercial Digital**. No se promete ni se menciona como compromiso la plataforma SaaS completa ni la consultoría DELTA OPS.

**Sí está dentro del alcance (Fase 1):**

- Base de datos central de productos (fuente única de verdad).
- Catálogo digital navegable (aplicación móvil / PWA).
- Fichas técnicas de producto estandarizadas.
- Integración con WhatsApp para cotización por sucursal.
- Sistema visual corporativo e identidad digital del catálogo.
- Renderizados, mockups y material comercial.
- Estructuración "integration-ready", documentación, capacitación y panel de administración.

**No está dentro del alcance de la Fase 1** (se contrata por separado en fases futuras):

- Sincronización en vivo de **precios y stock** con el software de punto de venta del cliente.
- Página web transaccional, CRM y gestión de inventario/operación en tiempo real.
- Hosting e infraestructura en nube, dominios y correo.
- Sesiones de fotografía de producto desde cero (ver pendientes).
- Cualquier módulo o integración no listado arriba.

---

## 5. El producto: Ecosistema de Catálogo Comercial Digital

La Fase 1 se construye sobre **cuatro capas funcionales** —fundacional, de estructuración, de presentación y de distribución— operando sobre una única base de datos. Se entrega en **siete módulos**:

| Módulo | Qué incluye |
|---|---|
| **C1 · Base de Datos Central de Productos** | Fuente única de verdad: taxonomía de categorías, atributos y especificaciones por tipo de producto, fichas por SKU, criterios de escalabilidad y mapeo de los flujos de información comercial. |
| **C2 · Catálogo Digital Navegable** | Navegación por categorías según la lógica de compra del sector; búsqueda inteligente por nombre, especificación, calibre o código; consulta en campo/obra; solicitud de cotización; avisos de novedades. |
| **C3 · Fichas Técnicas Estandarizadas** | Ficha por producto con fotografía, especificaciones, dimensiones, calibres y botón de cotización. Formato único, coherente y actualizable desde un solo lugar. |
| **C4 · Integración con WhatsApp** | Cotización y consulta encauzadas a WhatsApp; flujo estandarizado para todo el equipo; registro de la demanda capturada para informar compras y abastecimiento. |
| **C5 · Sistema Visual Corporativo** | Identidad digital industrial, maquetación de fichas, protocolo de fotografía técnica, iconografía por categoría y guía de uso, con adaptación multicanal. |
| **C6 · Renderizados, Mockups y Material Comercial** | Visualizaciones conceptuales del estándar de presentación y material comercial derivado del sistema visual. |
| **C7 · Estructuración Digital y Escalabilidad** | Arquitectura "integration-ready", publicación en los canales de la Fase 1, documentación, protocolo de actualización, capacitación al equipo de ventas y entrega del panel de administración. |

---

## 6. Decisiones clave del cliente

Decisiones tomadas con Gonzalo que definen **cómo** se construye el catálogo:

1. **Catálogo público "por mientras" = mínimo y limpio.** Cada producto público muestra **código + descripción/funcionamiento** (agregando especificaciones como el largo, calibre, material, etc.) **+ foto + botón Cotizar**. **Precio, existencia y proveedor quedan internos/ocultos** hasta conectar el software del cliente.
2. **Software de tienda = sistema propio/a medida** (lo desarrollan ingenieros externos del cliente). MOTRAE entrega un **conector genérico desacoplado** (Edge Function) para integrarlo después; la **sincronización en vivo de precio/stock es fase futura**.
3. **Arranque por etapas:** primero el catálogo, después el sync. La arquitectura nace "integration-ready".
4. **5 sucursales con stock distinto y WhatsApp propio.** El carrito **redirige al WhatsApp de la sucursal elegida** con el detalle de lo cotizado.
5. **Panel para los dueños** con estadísticas de comportamiento: producto más visto, más cotizado y más vendido; ahí mismo estará el editor inline avanzado.
6. **Las fotos van en una operativa posterior.** Con 3,000+ productos, el catálogo se programa con la **capacidad de llenado de fotos por código** (placeholders ahora, carga progresiva después).
7. **Editor inline avanzado** para el administrador (evolución de la "ventana de edición" en vivo de la propuesta): edición directa con persistencia real en base de datos, campos estructurados, apoyo de IA, validación, control de acceso (RLS) y bitácora de cambios. El administrador podrá **dar de alta o de baja productos**.
8. **Acceso público con precios visibles** como meta — los precios aparecen cuando se conecte el software del cliente.

---

## 7. Estructura del catálogo: datos y taxonomía

**Realidad verificada del catálogo maestro** (`CATALOGO PROD.PEÑASCAL 15 06 2026.xls`):

- **3,222 productos** en una sola hoja, organizados por proveedor.
- **53 proveedores**: cada producto está bajo un solo proveedor (sin duplicados exactos). La correlación "varios proveedores surten lo mismo" es **por tipo/equivalencia** (p. ej., la lámina la dan 13+ proveedores).
- El maestro **no trae precio ni categoría**; la existencia hoy figura en cero. Por eso la categorización y la correlación se construyen como entregable.

**Taxonomía propuesta — 14 categorías** (2 niveles: Categoría → Subcategoría), derivada del análisis de los 3,222 productos:

| # | Categoría | # | Categoría |
|---|---|---|---|
| 1 | Perfiles estructurales | 9 | Soldadura (consumibles) |
| 2 | Perfiles Tubulares | 10 | Abrasivos y discos |
| 3 | Acero (barra y placa) | 11 | Herramienta eléctrica |
| 4 | Láminas, placas y cubiertas | 12 | Herramienta manual |
| 5 | Tubería y conexiones | 13 | Pintura y químicos |
| 6 | Metal desplegado, mallas | 14 | Seguridad (EPP) |
| 7 | Tornillería y fijación |  |  |
| 8 | Herrería, forja y herrajes |  |  |

Esta taxonomía es la base de la navegación, la búsqueda inteligente y la correlación de proveedores por tipo. Cobertura de auto-clasificación: ~84.5%; el resto (en su mayoría forja ornamental y herrajes) se afina con un pase de IA y revisión del equipo comercial. **Sujeta a validación del cliente en la Fase 1.**

---

## 8. Requisitos funcionales

### Vista pública (cliente final)

- Navegación por las 14 categorías y subcategorías, con la lógica de compra del sector.
- Búsqueda inteligente por nombre comercial, especificación, medida, calibre o código.
- Ficha de producto estandarizada: código, descripción/funcionamiento (agregando especificaciones como el largo, calibre, material, etc.) y foto (placeholder mientras llega la fotografía real).
- **Botón Cotizar** y carrito que agrupa la selección.
- Al cotizar, el carrito **redirige al WhatsApp de la sucursal elegida** con el detalle del pedido.
- Experiencia limpia, guiada y responsive (celular, tablet y computadora).

### Panel de administración (equipo y dueños de Aceros Peñascal)

- **Editor inline avanzado**: alta y edición de productos en vivo, con persistencia en base de datos, campos estructurados, apoyo de IA y validación.
- Gestión de la **carga de fotos por código** (operativa progresiva).
- Campos **internos/ocultos** al público: precio, existencia y proveedor.
- **Panel de estadísticas** para los dueños: más visto, más cotizado, más vendido.
- Control de acceso por rol (RLS) y **bitácora de cambios** (quién cambió qué y cuándo).
- Generación de **QR por producto** (archivo aparte).

---

## 9. Requisitos Extras

- **Seguridad:** cifrado en tránsito y en reposo, roles y permisos, separación entre datos públicos del cliente y datos internos de la empresa, y bitácoras de auditoría.
- **Protección de datos:** tratamiento conforme a la **LFPDPPP** (Ley Federal de Protección de Datos Personales en Posesión de los Particulares).
- **Escalabilidad:** diseñado para 3,000+ productos y crecimiento del portafolio sin reconstruir.
- **"Integration-ready":** arquitectura desacoplada que admite el conector al software de punto de venta del cliente sin rehacer el sistema.
- **Rendimiento y usabilidad:** carga ágil, búsqueda rápida y operación fluida desde el sitio de obra.
- **Stack destino:** Supabase (Postgres + RLS + Auth + Storage + Edge Functions) y Next.js como PWA.

---

## 10. Identidad visual del catálogo

El catálogo usa una **paleta industrial propia**, definida con el cliente, que **prevalece sobre la marca MOTRAE** para este producto (porque es la cara digital de Aceros Peñascal, no de MOTRAE):

| Rol | Color | Uso |
|---|---|---|
| **Base** | Grises acero (blanco → negro) | Estructura, fondos, neutros del sistema |
| **Acento de marca** | Rojo `#921A2A` | Color oficial del logo de Aceros Peñascal |
| **Contorno de fichas** | Aqua intenso `#0E7E8C` | Bordes y realces de las fichas de producto |
| **Etiquetas** | Verde zintro `#4E9A51` | Tags y marcadores de categoría |

El logo real de Aceros Peñascal es azul marino + rojo carmín (no gris/naranja). El sistema visual incluye iconografía técnica por categoría, protocolo de fotografía (fondo neutro, iluminación uniforme, escala de referencia, múltiples ángulos) y guía de uso multicanal (WhatsApp, móvil, impreso y pantalla).

---

## 11. Entregables, fases y cronograma

Plan base de **25 a 35 días hábiles**, en fases verificables con entregas parciales para validación:

| Fase | Días | Entregable / hito |
|---|---|---|
| **F1 · Planeación y Arquitectura Comercial** | 1–5 | Kick-off, diagnóstico del portafolio, estructura de datos y taxonomía aprobadas. |
| **F2 · Diseño Visual Corporativo** | 6–12 | Sistema visual, identidad digital, templates de ficha y primeras fichas (entregable parcial). |
| **F3 · Maquetación del Catálogo** | 13–22 | Carga de contenido y registro producto a producto; catálogo completo en revisión (entregable parcial). |
| **F4 · Renderizados y Mockups** | 23–28 | Visualizaciones conceptuales y material comercial aprobados. |
| **F5 · Integración Digital y Entrega** | 29–35 | Integración WhatsApp, publicación, capacitación, documentación y entrega final (Pago 2). |

Cada entregable incluye **una ronda de revisión sin costo**; el cliente dispone de **5 días hábiles** para aceptar o rechazar por escrito. Comunicación: actualización semanal de avance y canal directo con el responsable del proyecto.

---

## 12. Condiciones comerciales

| Concepto | Monto (MXN) |
|---|---|
| **Planeación y Arquitectura Comercial** | $8,000 |
| **Diseño Visual Corporativo** | $12,000 |
| **Maquetación de Catálogo Digital** | $20,000 |
| **Renderizados y Mockups Comerciales** | $5,000 |
| **Estructuración Digital y Escalabilidad** | $5,000 |
| **Total del proyecto (más IVA)** | **$50,000** |

**Pago en 2 exhibiciones:** 50% ($25,000 + IVA) a la firma · 50% ($25,000 + IVA) a la entrega final (Día 35). Esquemas alternativos de pago disponibles para discusión. Garantía de corrección de defectos: 30 días naturales posteriores al Go-Live. Al pago total, todos los activos son **propiedad de Aceros Peñascal**, sin dependencia permanente de MOTRAE.

---

## 13. Pendientes del cliente para el build

Para arrancar la fase de producción, Aceros Peñascal debe proporcionar:

- **Lista de precios** del portafolio (para la fase en que se muestren / se conecten).
- **Fotografías utilizables** de producto (o confirmar producción fotográfica desde cero, a cotizar).
- **Hosting / infraestructura** (Supabase + Vercel u otro), si corre por su cuenta.
- **Cómo expone los datos su sistema de punto de venta** (para el conector y el sync futuro).
- **Validación de la taxonomía** y del volumen real de SKU a cargar.

> Sucursales y números de WhatsApp ya fueron entregados por el cliente y están integrados.

---

## 14. Fuera de alcance: fases futuras

La Fase 1 deja el terreno preparado para —en contratos posteriores— habilitar:

- **Sincronización en vivo** de precios y stock con el software de punto de venta.
- **Página web transaccional** con compra en línea.
- **Gestión de clientes (CRM)** y datos de facturación (CFDI).
- **Gestión de inventario y operación** con stock en tiempo real por sucursal.
- **Geolocalización**: sucursal más cercana, cálculo de envío por distancia y notificaciones de entrega.
- **IA integrada** entrenada con el catálogo, precios y disponibilidad.

Todas se presupuestan y contratan por separado mediante Control de Cambios.

---

## 15. Datos del proyecto y contacto

| Campo | Dato |
|---|---|
| **Proveedor** | MOTRAE México |
| **Cliente** | Aceros Peñascal · Xalapa, Veracruz |
| **Proyecto** | Ecosistema de Catálogo Comercial Digital (Fase 1) |
| **Equipo MOTRAE** | Gonzalo Jácome (Producto y Tecnología) · Mauricio Flores (Estrategia y Desarrollo Comercial) · Gerson Rivera (Operaciones) |
| **Email** | motrae.gmg@gmail.com |
| **Teléfono** | 228 353 6911 |

---

<div align="center">

**MOTRAE** · *Innovation already in motion*
Documento de proyecto · Confidencial · Junio 2026 · Xalapa, Veracruz · México

</div>
