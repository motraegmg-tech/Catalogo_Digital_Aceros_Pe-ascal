# Pipeline de enriquecimiento del catálogo — Aceros Peñascal

Clasifica los **3,222 productos** en las 14 categorías y, por cada uno, escribe
**subcategoría, marca, material, medida, unidad, funcionamiento, especificaciones y
palabras clave** — usando la **API de Claude** (Batch API + salida estructurada JSON).
Resuelve los 501 "POR CLASIFICAR" y deja el catálogo listo para mostrar.

## Pasos (una sola vez)
1. **Pega tu API key:** copia `.env.example` como `.env` y pon tu key de Anthropic
   (`ANTHROPIC_API_KEY=sk-ant-...`). El `.env` está en `.gitignore`: la key no se sube a ningún lado.
2. **Instala:** en esta carpeta, `npm install`.
3. **Prueba rápida (3 productos):** `npm run smoke` — revisa que el formato te guste.
4. **Corrida completa:** `npm run run` — envía el batch (50% más barato) y espera (suele < 1 h).
   Si se corta, reanuda con `npm run poll` (guarda el id en `.batch_id`).

Salida → `..\datos\catalogo_enriquecido.json`.

## Modelo y costo (estimado, con Batch API + caché)
Por defecto **`claude-opus-4-8`** (máxima calidad). Para bajar costo, pon `MODEL=` en `.env`:

| Modelo | Calidad | Costo aprox. 3,222 prod |
|---|---|---|
| `claude-opus-4-8` (default) | Máxima | ~$10–14 USD |
| `claude-sonnet-4-6` | Alta | ~$6–8 USD |
| `claude-haiku-4-5` | Buena, rápida | ~$2–3 USD |

(Estimaciones; el costo real depende de la longitud de salida. La salida estructurada y la
caché del prompt de sistema mantienen el costo bajo.)

## Notas
- El cruce con la realidad de specs sale del conocimiento del modelo sobre el sector
  (acero/ferretería/herramienta MX). Para SKU de marca poco comunes se puede hacer una
  pasada extra de investigación web sobre los no resueltos.
- Tras revisar `catalogo_enriquecido.json`, se regenera `productos.js` para que la PWA
  muestre funcionamiento y specs.
