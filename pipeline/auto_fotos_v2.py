#!/usr/bin/env python3
"""
auto_fotos_v2.py — Pipeline modular de fotos para Aceros Peñascal.

Principio de responsabilidad única (Clean Code):
  - config.py      → constantes y rutas
  - data_loader    → carga catálogo y plantilla (solo lectura)
  - domain_guard   → filtra URLs por dominios oficiales del proveedor
  - query_builder  → construye consulta de búsqueda precisa
  - image_fetcher  → busca y descarga la imagen desde fuente oficial
  - image_pipeline → limpia fondo, neutraliza marca de agua, estandariza
  - reporter       → escribe CSV de auditoría

Uso:
  python3 pipeline/auto_fotos_v2.py              # simulación (dry-run)
  python3 pipeline/auto_fotos_v2.py --apply      # descarga y guarda
  python3 pipeline/auto_fotos_v2.py --apply --limit 20
  python3 pipeline/auto_fotos_v2.py --apply --proveedor "CASCAR INTERNATIONAL S. DE R.L DE C.V"
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import random
import re
import sys
import time
import unicodedata
from dataclasses import dataclass, field
from io import BytesIO
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence
from urllib.parse import urlparse

# ---------------------------------------------------------------------------
# Dependencias externas (instaladas en venv_fotos)
# ---------------------------------------------------------------------------
try:
    import requests
    # pyrefly: ignore [missing-import]
    from ddgs import DDGS
    from PIL import Image, ImageChops, ImageFilter, ImageStat
    # pyrefly: ignore [missing-import]
    from rembg import new_session, remove
except ImportError as _e:
    sys.exit(
        f"[FATAL] Dependencia no encontrada: {_e}\n"
        "Activa el entorno virtual: source pipeline/venv_fotos/bin/activate"
    )

# ===========================================================================
# MÓDULO 1: Configuración y constantes
# ===========================================================================

BASE_DIR = Path(__file__).resolve().parent
ROOT_DIR = BASE_DIR.parent

PRODUCTOS_JSON   = ROOT_DIR / "catalogo-web" / "data" / "productos.json"
PLANTILLA_CSV    = ROOT_DIR / "datos" / "plantilla_fotos.csv"
DOMINIOS_JSON    = ROOT_DIR / "datos" / "proveedores_dominios.json"
REPORTE_CSV      = ROOT_DIR / "datos" / "auto_fotos_reporte_v2.csv"
FOTOS_DIR        = ROOT_DIR / "catalogo-web" / "fotos"

CANVAS_SIZE      = (800, 800)
PRODUCT_MAX_SIZE = (740, 740)
MIN_IMAGE_BYTES  = 4_096
MIN_IMAGE_EDGE   = 180
ALPHA_THRESHOLD  = 10
CROP_MARGIN      = 18
WATERMARK_ALPHA  = 70
DELAY_RANGE      = (1.5, 3.0)
MAX_RESULTS_PER_DOMAIN = 6

RESAMPLE = getattr(Image, "Resampling", Image).LANCZOS

logging.basicConfig(
    format="%(asctime)s %(levelname)-8s %(message)s",
    datefmt="%H:%M:%S",
    level=logging.INFO,
    stream=sys.stdout,
)
log = logging.getLogger("auto_fotos_v2")

# ===========================================================================
# MÓDULO 2: Tipos de datos
# ===========================================================================

@dataclass(frozen=True)
class PendienteItem:
    """Producto sin-foto listo para ser procesado."""
    cod: str
    nom: str
    cat: str
    sub: str
    med: str
    proveedor: str
    archivo_destino: Path


@dataclass
class Resultado:
    """Resultado de procesar un PendienteItem."""
    cod: str
    proveedor: str
    archivo: str
    estado: str        # ok | skip | dry-run | error
    detalle: str
    url: str = ""


# ===========================================================================
# MÓDULO 3: Carga de datos (SOLO LECTURA — productos.json nunca se toca)
# ===========================================================================

def _normalizar(valor: Any) -> str:
    txt = "" if valor is None else str(valor)
    txt = unicodedata.normalize("NFKD", txt)
    txt = "".join(c for c in txt if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", txt).strip().lower()


def _primer_valor(d: Dict[str, Any], claves: Sequence[str]) -> str:
    for k in claves:
        v = d.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return ""


def cargar_catalogo() -> List[Dict[str, Any]]:
    """Lee productos.json en modo lectura. Nunca lo modifica."""
    with PRODUCTOS_JSON.open("r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data.get("productos"), list):
        raise ValueError("productos.json no tiene la estructura esperada.")
    return [p for p in data["productos"] if isinstance(p, dict)]


def es_sin_foto(producto: Dict[str, Any]) -> bool:
    etq = producto.get("etq")
    return isinstance(etq, list) and "sin-foto" in etq


def cargar_plantilla() -> Dict[str, str]:
    """Devuelve {codigo_normalizado: nombre_archivo}."""
    mapa: Dict[str, str] = {}
    with PLANTILLA_CSV.open("r", encoding="utf-8-sig", newline="") as f:
        for fila in csv.DictReader(f):
            cod = _primer_valor(fila, ("codigo", "cod", "sku", "id"))
            arch = _primer_valor(fila, ("archivo_foto", "foto", "imagen", "file"))
            if cod and arch:
                mapa[_normalizar(cod)] = arch
    return mapa


def cargar_dominios() -> Dict[str, List[str]]:
    """Devuelve {proveedor_normalizado: [dominio, ...]}."""
    if not DOMINIOS_JSON.exists():
        log.warning("proveedores_dominios.json no encontrado en %s", DOMINIOS_JSON)
        return {}
    with DOMINIOS_JSON.open("r", encoding="utf-8") as f:
        raw = json.load(f)
    result: Dict[str, List[str]] = {}
    for prov, dominios in raw.items():
        if prov.startswith("_"):
            continue
        if isinstance(dominios, str):
            dominios = [dominios]
        if not isinstance(dominios, list):
            continue
        limpios = [_normalizar_dominio(d) for d in dominios if _normalizar_dominio(d)]
        result[_normalizar(prov)] = sorted(set(limpios))
    return result


def construir_pendientes(
    productos: List[Dict[str, Any]],
    plantilla: Dict[str, str],
) -> List[PendienteItem]:
    """Filtra solo los productos sin-foto y construye la lista de trabajo."""
    pendientes: List[PendienteItem] = []
    for p in productos:
        if not es_sin_foto(p):
            continue
        cod = _primer_valor(p, ("cod", "codigo", "id", "sku"))
        if not cod:
            continue
        arch = plantilla.get(_normalizar(cod))
        if not arch:
            # Fallback: usa el campo foto si no es URL, o genera nombre
            foto = _primer_valor(p, ("foto",))
            if foto and not _es_url(foto):
                arch = Path(foto.replace("\\", "/")).name
            else:
                arch = f"{cod}.webp"
        destino = _ruta_segura(arch)
        pendientes.append(PendienteItem(
            cod=cod,
            nom=_primer_valor(p, ("nom", "nombre", "descripcion")),
            cat=_primer_valor(p, ("cat",)),
            sub=_primer_valor(p, ("sub",)),
            med=_primer_valor(p, ("med",)),
            proveedor=_primer_valor(p, ("prov", "proveedor")),
            archivo_destino=destino,
        ))
    return pendientes


def _ruta_segura(archivo: str) -> Path:
    nombre = Path(archivo.replace("\\", "/")).name
    if not nombre:
        raise ValueError(f"Nombre de archivo vacío para: {archivo!r}")
    destino = (FOTOS_DIR / nombre).resolve()
    destino.relative_to(FOTOS_DIR.resolve())  # evita path traversal
    return destino


# ===========================================================================
# MÓDULO 4: Guardián de dominios (Domain Guard)
# ===========================================================================

def _normalizar_dominio(valor: Any) -> str:
    txt = str(valor).strip() if valor else ""
    if not txt:
        return ""
    if not re.match(r"^https?://", txt, re.I):
        txt = "https://" + txt
    host = urlparse(txt).netloc.lower().split(":")[0]
    return host[4:] if host.startswith("www.") else host


def _host_de_url(url: str) -> str:
    host = urlparse(url).netloc.lower().split(":")[0]
    return host[4:] if host.startswith("www.") else host


def _es_url(valor: str) -> bool:
    return str(valor).lower().startswith(("http://", "https://"))


def url_es_permitida(url: str, dominios: Sequence[str]) -> bool:
    """Devuelve True SOLO si la URL pertenece a un dominio oficial del proveedor."""
    if not url or not _es_url(url) or not dominios:
        return False
    host = _host_de_url(url)
    return any(host == d or host.endswith("." + d) for d in dominios)


# ===========================================================================
# MÓDULO 5: Constructor de consulta (Query Builder)
# ===========================================================================

_RUIDO = re.compile(
    r"\b(POR CLASIFICAR|sin foto|sinfoto|sin-foto|sin-conocimiento)\b",
    re.I,
)

def construir_consulta(item: PendienteItem) -> str:
    """
    Genera una consulta de búsqueda precisa para el producto.

    Estrategia:
      - Usa código + nombre + medida para ser específico
      - Añade categoría como contexto ferretero
      - Elimina tokens de ruido del clasificador
    """
    partes = [item.cod, item.nom]
    if item.med:
        partes.append(item.med)
    if item.cat:
        partes.append(item.cat)
    consulta = " ".join(p for p in partes if p)
    consulta = _RUIDO.sub(" ", consulta)
    return re.sub(r"\s+", " ", consulta).strip()


# ===========================================================================
# MÓDULO 6: Buscador y descargador de imagen
# ===========================================================================

SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/126.0.0.0 Safari/537.36"
    ),
    "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
})


def _url_imagen_resultado(r: Dict[str, Any]) -> str:
    return _primer_valor(r, ("image", "thumbnail", "url"))


def _url_fuente_resultado(r: Dict[str, Any]) -> str:
    return _primer_valor(r, ("source", "page_url", "href", "origin"))


def buscar_imagen_en_fuente_oficial(
    ddgs: DDGS,
    item: PendienteItem,
    dominios: List[str],
) -> Optional[str]:
    """
    Busca una imagen EXCLUSIVAMENTE en los dominios oficiales del proveedor.
    Devuelve la primera URL de imagen válida o None si no encuentra nada seguro.
    """
    consulta_base = construir_consulta(item)
    if not consulta_base:
        return None

    for dominio in dominios:
        query = f"{consulta_base} site:{dominio}"
        log.debug("Buscando: %s", query)
        try:
            resultados = list(ddgs.images(query, max_results=MAX_RESULTS_PER_DOMAIN))
        except Exception as exc:
            log.debug("DDG error en dominio %s: %s", dominio, exc)
            continue

        for r in resultados:
            img_url = _url_imagen_resultado(r)
            src_url = _url_fuente_resultado(r)

            # Imagen directamente en dominio oficial
            if img_url and url_es_permitida(img_url, dominios):
                return img_url

            # La página fuente es oficial aunque la CDN de imagen sea externa
            if img_url and src_url and url_es_permitida(src_url, dominios):
                return img_url

    return None


def descargar_imagen(url: str, dominios: Sequence[str]) -> bytes:
    """Descarga bytes de imagen SOLO si la URL está en dominio oficial."""
    if not url_es_permitida(url, dominios):
        raise ValueError(f"URL rechazada (fuera de dominio oficial): {url}")

    resp = SESSION.get(url, timeout=25)
    resp.raise_for_status()

    contenido = resp.content
    ct = resp.headers.get("content-type", "").lower()
    firma_ok = contenido[:4] in (b"\xff\xd8\xff\xe0", b"\x89PNG", b"RIFF", b"GIF8") or contenido[:3] == b"\xff\xd8\xff"
    if "image" not in ct and not firma_ok:
        raise ValueError("La respuesta no parece ser una imagen válida.")
    if len(contenido) < MIN_IMAGE_BYTES:
        raise ValueError("Imagen demasiado pequeña (posible placeholder).")
    return contenido


# ===========================================================================
# MÓDULO 7: Pipeline de imagen (limpieza, estandarización)
# ===========================================================================

def _abrir_imagen(datos: bytes) -> Image.Image:
    img = Image.open(BytesIO(datos))
    img.load()
    if img.width < MIN_IMAGE_EDGE or img.height < MIN_IMAGE_EDGE:
        raise ValueError(
            f"Resolución insuficiente ({img.width}x{img.height}), mínimo {MIN_IMAGE_EDGE}px."
        )
    return img.convert("RGBA")


def _remover_fondo(datos: bytes, sesion_ia: Any) -> Image.Image:
    """Usa rembg para recortar el fondo. Fallback: imagen original si falla."""
    original = _abrir_imagen(datos)
    try:
        sin_fondo = Image.open(BytesIO(remove(datos, session=sesion_ia))).convert("RGBA")
        if sin_fondo.getchannel("A").getbbox():
            return sin_fondo
    except Exception as exc:
        log.debug("rembg falló, usando original: %s", exc)
    return original


def _neutralizar_marca_agua(imagen: Image.Image) -> Image.Image:
    """
    Detecta patrones típicos de marcas de agua semi-transparentes en bordes
    y los atenúa con una capa blanca. Conserva el contenido central intacto.
    """
    if imagen.mode != "RGBA":
        imagen = imagen.convert("RGBA")

    alpha = imagen.getchannel("A")
    w, h = imagen.size
    centro = alpha.crop((w // 5, h // 5, w * 4 // 5, h * 4 // 5))

    # Solo actúa si el canal alfa central es casi opaco (imagen con fondo)
    if ImageStat.Stat(centro).mean[0] < 245:
        return imagen

    gris = imagen.convert("RGB").convert("L")
    bordes = gris.filter(ImageFilter.FIND_EDGES)
    mascara_mw = bordes.point(lambda p: 255 if 12 <= p <= 42 else 0)
    mascara_mw = mascara_mw.filter(ImageFilter.GaussianBlur(1.2))
    mascara_mw = ImageChops.multiply(
        mascara_mw,
        alpha.point(lambda p: 255 if p > 245 else 0),
    )
    overlay = Image.new("RGBA", imagen.size, (255, 255, 255, WATERMARK_ALPHA))
    return Image.composite(overlay, imagen, mascara_mw).convert("RGBA")


def _recortar_producto(imagen: Image.Image) -> Image.Image:
    """Recorta el bounding-box del producto con margen de seguridad."""
    alpha = imagen.getchannel("A")
    mascara = alpha.point(lambda p: 255 if p > ALPHA_THRESHOLD else 0)
    bbox = mascara.getbbox()
    if not bbox:
        return imagen
    l = max(0, bbox[0] - CROP_MARGIN)
    t = max(0, bbox[1] - CROP_MARGIN)
    r = min(imagen.width,  bbox[2] + CROP_MARGIN)
    b = min(imagen.height, bbox[3] + CROP_MARGIN)
    return imagen.crop((l, t, r, b))


def _componer_canvas(imagen: Image.Image) -> Image.Image:
    """Centra el producto en un canvas 800×800 con fondo blanco sólido."""
    imagen.thumbnail(PRODUCT_MAX_SIZE, RESAMPLE)
    canvas = Image.new("RGBA", CANVAS_SIZE, (255, 255, 255, 255))
    x = (CANVAS_SIZE[0] - imagen.width) // 2
    y = (CANVAS_SIZE[1] - imagen.height) // 2
    canvas.alpha_composite(imagen, (x, y))
    return canvas.convert("RGB")


def estandarizar_imagen(datos: bytes, sesion_ia: Any) -> Image.Image:
    """
    Pipeline completo:
      1. Remover fondo (rembg)
      2. Neutralizar marcas de agua residuales
      3. Recortar al producto con margen seguro
      4. Centrar en canvas 800x800 fondo blanco
    """
    imagen = _remover_fondo(datos, sesion_ia)
    imagen = _neutralizar_marca_agua(imagen)
    imagen = _recortar_producto(imagen)
    return _componer_canvas(imagen)


def guardar_imagen(imagen: Image.Image, destino: Path) -> Path:
    """Guarda en el formato indicado por la extensión del destino.
    Devuelve la ruta real donde se guardó el archivo."""
    destino.parent.mkdir(parents=True, exist_ok=True)
    ext = destino.suffix.lower()
    if ext in (".jpg", ".jpeg"):
        imagen.save(destino, "JPEG", quality=92, optimize=True, progressive=True)
        return destino
    elif ext == ".png":
        imagen.save(destino, "PNG", optimize=True)
        return destino
    else:
        # Default: WebP (el formato estándar del catálogo)
        ruta_webp = destino.with_suffix(".webp")
        imagen.save(ruta_webp, "WEBP", quality=86, method=6)
        return ruta_webp


# ===========================================================================
# MÓDULO 8: Procesador central (orquesta los módulos anteriores)
# ===========================================================================

def procesar_item(
    ddgs: DDGS,
    item: PendienteItem,
    dominios: List[str],
    args: argparse.Namespace,
    sesion_ia: Any,
) -> Resultado:
    """
    Orquesta la búsqueda, descarga y estandarización para un producto.

    Política de omisión (skip sin descargar falso positivo):
      - Proveedor sin dominios configurados → skip
      - No encontró imagen en fuente oficial → skip
      - Modo dry-run → dry-run (no descarga nada)
    
    NOTA: --overwrite siempre activo en esta versión (primera vuelta).
    """
    if not dominios:
        return Resultado(
            item.cod, item.proveedor, item.archivo_destino.name,
            "skip", "proveedor sin dominios oficiales configurados"
        )

    if not args.apply:
        return Resultado(
            item.cod, item.proveedor, item.archivo_destino.name,
            "dry-run", f"pendiente — dominio(s): {', '.join(dominios)}"
        )

    url = buscar_imagen_en_fuente_oficial(ddgs, item, dominios)
    if not url:
        return Resultado(
            item.cod, item.proveedor, item.archivo_destino.name,
            "skip", "sin coincidencia en fuente oficial"
        )

    try:
        datos = descargar_imagen(url, dominios)
    except Exception as exc:
        return Resultado(
            item.cod, item.proveedor, item.archivo_destino.name,
            "error", f"descarga fallida: {exc}", url
        )

    try:
        imagen = estandarizar_imagen(datos, sesion_ia)
    except Exception as exc:
        return Resultado(
            item.cod, item.proveedor, item.archivo_destino.name,
            "error", f"procesamiento fallido: {exc}", url
        )

    try:
        ruta_guardada = guardar_imagen(imagen, item.archivo_destino)
    except Exception as exc:
        return Resultado(
            item.cod, item.proveedor, item.archivo_destino.name,
            "error", f"guardado fallido: {exc}", url
        )

    return Resultado(
        item.cod, item.proveedor, ruta_guardada.name,
        "ok", f"guardado en {ruta_guardada}", url
    )


# ===========================================================================
# MÓDULO 9: Reporter (auditoría CSV)
# ===========================================================================

def escribir_reporte(resultados: List[Resultado], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    campos = ["cod", "proveedor", "archivo", "estado", "detalle", "url"]
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=campos)
        w.writeheader()
        for r in resultados:
            w.writerow(r.__dict__)
    log.info("Reporte guardado en %s", path)


def imprimir_resumen(resultados: List[Resultado]) -> None:
    conteo: Dict[str, int] = {}
    for r in resultados:
        conteo[r.estado] = conteo.get(r.estado, 0) + 1
    linea = ", ".join(f"{k}={v}" for k, v in sorted(conteo.items()))
    log.info("Resumen final: %s", linea)


# ===========================================================================
# MÓDULO 10: CLI y punto de entrada
# ===========================================================================

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description=(
            "Pipeline modular de fotos para Aceros Peñascal.\n"
            "Busca y estandariza imágenes SOLO para productos marcados 'sin-foto',\n"
            "descargándolas exclusivamente de los catálogos oficiales de cada proveedor."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument(
        "--apply",
        action="store_true",
        help="Descarga, procesa y guarda imágenes. Sin esta bandera es simulación.",
    )
    p.add_argument(
        "--limit",
        type=int,
        default=0,
        metavar="N",
        help="Procesa solo los primeros N productos (0 = todos).",
    )
    p.add_argument(
        "--proveedor",
        type=str,
        default="",
        metavar="NOMBRE",
        help="Filtra solo los productos de ese proveedor exacto.",
    )
    p.add_argument(
        "--dominios",
        type=Path,
        default=DOMINIOS_JSON,
        help=f"JSON proveedor→dominios (default: {DOMINIOS_JSON})",
    )
    p.add_argument(
        "--reporte",
        type=Path,
        default=REPORTE_CSV,
        help=f"Ruta del CSV de auditoría (default: {REPORTE_CSV})",
    )
    p.add_argument(
        "--verbose",
        action="store_true",
        help="Activa logs de depuración (DEBUG).",
    )
    return p.parse_args()


def main() -> int:
    args = parse_args()

    if args.verbose:
        log.setLevel(logging.DEBUG)

    log.info("=" * 60)
    log.info("Auto Fotos v2 — Aceros Peñascal")
    log.info("productos.json: %s (SOLO LECTURA)", PRODUCTOS_JSON)
    log.info("Modo: %s", "APLICAR" if args.apply else "SIMULACIÓN")
    log.info("=" * 60)

    # --- Carga de datos ---
    productos = cargar_catalogo()
    plantilla  = cargar_plantilla()
    dominios_por_prov = cargar_dominios()

    # --- Construir lista de trabajo ---
    pendientes = construir_pendientes(productos, plantilla)

    # Filtro opcional por proveedor
    if args.proveedor:
        prov_norm = _normalizar(args.proveedor)
        pendientes = [p for p in pendientes if _normalizar(p.proveedor) == prov_norm]
        log.info("Filtrando por proveedor: %s → %d productos", args.proveedor, len(pendientes))

    if args.limit > 0:
        pendientes = pendientes[:args.limit]

    log.info("Productos sin-foto a procesar: %d", len(pendientes))
    log.info("Proveedores con dominios configurados: %d", sum(1 for v in dominios_por_prov.values() if v))

    # --- Inicializar modelo IA solo si se va a aplicar ---
    sesion_ia = None
    if args.apply:
        log.info("Cargando modelo de recorte de fondo (u2net)...")
        sesion_ia = new_session("u2net")
        log.info("Modelo listo.")

    # --- Procesamiento principal ---
    resultados: List[Resultado] = []

    with DDGS() as ddgs:
        for idx, item in enumerate(pendientes, 1):
            dominios = dominios_por_prov.get(_normalizar(item.proveedor), [])
            prefix = f"[{idx}/{len(pendientes)}]"
            log.info("%s %s | %s", prefix, item.cod, item.nom[:50])

            try:
                resultado = procesar_item(ddgs, item, dominios, args, sesion_ia)
            except Exception as exc:
                resultado = Resultado(
                    item.cod, item.proveedor, item.archivo_destino.name,
                    "error", str(exc)
                )

            resultados.append(resultado)
            log.info(
                "%s → %s: %s",
                prefix, resultado.estado.upper(), resultado.detalle
            )

            # Espera educada entre descargas reales
            if args.apply and resultado.estado in {"ok", "error"}:
                time.sleep(random.uniform(*DELAY_RANGE))

    # --- Reporte y resumen ---
    escribir_reporte(resultados, args.reporte)
    imprimir_resumen(resultados)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        log.info("Interrumpido por el usuario.")
        raise SystemExit(130)
    except Exception as exc:
        log.error("Error fatal: %s", exc, exc_info=True)
        raise SystemExit(1)
