#!/usr/bin/env python3
"""
procesar_fotos_crudas.py — Pipeline de estandarización de imágenes manuales.

Lee las imágenes de pipeline/fotos_crudas/, las empareja con productos del
catálogo mediante coincidencia por nombre, aplica el pipeline de imagen y
guarda el resultado en catalogo-web/fotos/ con la nomenclatura de plantilla_fotos.csv.

Principio de responsabilidad única (Clean Code):
  - MÓDULO 1: Configuración y constantes
  - MÓDULO 2: Tipos de datos
  - MÓDULO 3: Carga de datos    (productos.json — SOLO LECTURA)
  - MÓDULO 4: Matching          (nombre de producto ↔ archivo crudo)
  - MÓDULO 5: Pipeline de imagen (rembg + Pillow)
  - MÓDULO 6: Writer de salida  (destino según plantilla_fotos.csv)
  - MÓDULO 7: Reporter          (CSV de auditoría)
  - MÓDULO 8: CLI y main

Uso:
  python3 pipeline/procesar_fotos_crudas.py            # simulación
  python3 pipeline/procesar_fotos_crudas.py --apply    # procesa y guarda
  python3 pipeline/procesar_fotos_crudas.py --apply --verbose
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import re
import sys
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Dict, List, Optional, Tuple

try:
    from PIL import Image, ImageStat
    from rembg import new_session, remove
except ImportError as exc:
    sys.exit(
        f"[FATAL] Dependencia faltante: {exc}\n"
        "Ejecuta: source pipeline/venv_fotos/bin/activate"
    )

# ===========================================================================
# MÓDULO 1: Configuración y constantes
# ===========================================================================

BASE_DIR      = Path(__file__).resolve().parent
ROOT_DIR      = BASE_DIR.parent

FOTOS_CRUDAS  = BASE_DIR / "fotos_crudas"
PRODUCTOS_JSON = ROOT_DIR / "catalogo-web" / "data" / "productos.json"
PLANTILLA_CSV  = ROOT_DIR / "datos" / "plantilla_fotos.csv"
FOTOS_DIR      = ROOT_DIR / "catalogo-web" / "fotos"
REPORTE_CSV    = ROOT_DIR / "datos" / "reporte_fotos_crudas.csv"

CANVAS_SIZE      = (800, 800)
PRODUCT_MAX_SIZE = (740, 740)
MIN_EDGE_PX      = 100          # mínimo aceptable para considerar la imagen
CROP_MARGIN_PX   = 20           # margen alrededor del producto recortado
ALPHA_THRESHOLD  = 15           # umbral de canal alfa para detección de bordes
BG_COLOR         = (255, 255, 255, 255)   # blanco sólido
RESAMPLE         = getattr(Image, "Resampling", Image).LANCZOS

# Extensiones de imagen aceptadas en fotos_crudas (incluye .avif de la segunda vuelta)
EXTS_VALIDAS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff", ".avif"}
# Extensiones que definitivamente NO son imágenes (se excluyen siempre)
EXTS_EXCLUIDAS = {".pdf", ".doc", ".docx", ".xls", ".xlsx", ".txt", ".csv"}

logging.basicConfig(
    format="%(asctime)s %(levelname)-8s %(message)s",
    datefmt="%H:%M:%S",
    level=logging.INFO,
    stream=sys.stdout,
)
log = logging.getLogger("procesar_fotos_crudas")


# ===========================================================================
# MÓDULO 2: Tipos de datos
# ===========================================================================

@dataclass(frozen=True)
class Match:
    """Par (producto, archivo_crudo) confirmado para procesar."""
    cod: str
    nom: str
    archivo_crudo: Path        # imagen original en fotos_crudas/
    archivo_destino: Path      # ruta final en catalogo-web/fotos/


@dataclass
class Resultado:
    """Resultado de procesar un Match."""
    cod: str
    nom: str
    archivo_crudo: str
    archivo_destino: str
    estado: str          # ok | skip | error
    detalle: str


# ===========================================================================
# MÓDULO 3: Carga de datos (productos.json → SOLO LECTURA)
# ===========================================================================

def _primer_valor(d: dict, claves: tuple) -> str:
    for k in claves:
        v = d.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return ""


def cargar_productos_sin_foto() -> List[dict]:
    """
    Lee productos.json y devuelve SOLO los productos marcados 'sin-foto'. NUNCA lo modifica.

    Los archivos que ya completamos y quitamos de 'sin-foto' seguirán en fotos_crudas/
    como histórico — aparecerán como huérfanos en el reporte, lo cual es correcto
    y esperado. No deben procesarse de nuevo.
    """
    with PRODUCTOS_JSON.open("r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data.get("productos"), list):
        raise ValueError("productos.json no tiene la estructura esperada.")
    todos = [p for p in data["productos"] if isinstance(p, dict)]
    return [p for p in todos if "sin-foto" in (p.get("etq") or [])]



def cargar_plantilla() -> Dict[str, str]:
    """Lee plantilla_fotos.csv y devuelve {cod_normalizado: nombre_archivo_destino}."""
    mapa: Dict[str, str] = {}
    with PLANTILLA_CSV.open("r", encoding="utf-8-sig", newline="") as f:
        for fila in csv.DictReader(f):
            cod  = _primer_valor(fila, ("codigo", "cod", "sku", "id"))
            arch = _primer_valor(fila, ("archivo_foto", "foto", "imagen", "file"))
            if cod and arch:
                mapa[cod.strip().upper()] = arch.strip()
    return mapa


def _es_imagen_valida(ruta: Path) -> bool:
    """
    Determina si un archivo es una imagen utilizable.
    Estrategia:
      1. Si la extensión está en EXTS_EXCLUIDAS → rechazar sin intentar abrir.
      2. Si la extensión está en EXTS_VALIDAS → aceptar.
      3. Si la extensión es desconocida o no existe (p.ej. archivos sin extensión
         o con extensión rota) → intentar abrir con Pillow para verificar.
    Esto cubre: .avif, archivos sin extensión, nombres con puntos en el medio.
    """
    ext = ruta.suffix.lower()
    if ext in EXTS_EXCLUIDAS:
        return False
    if ext in EXTS_VALIDAS:
        return True
    # Intento de apertura con Pillow para extensiones desconocidas
    try:
        with Image.open(ruta) as img:
            img.verify()
        return True
    except Exception:
        return False


def listar_fotos_crudas() -> List[Path]:
    """
    Devuelve todas las imágenes utilizables en fotos_crudas/.
    Acepta extensiones estándar (.jpg, .png, .webp, .avif, etc.) y también
    archivos sin extensión o con extensión no estándar que Pillow pueda abrir.
    Excluye PDFs, documentos y cualquier no-imagen.
    """
    if not FOTOS_CRUDAS.exists():
        raise FileNotFoundError(f"Carpeta no encontrada: {FOTOS_CRUDAS}")
    resultado = []
    for f in FOTOS_CRUDAS.iterdir():
        if not f.is_file():
            continue
        if _es_imagen_valida(f):
            resultado.append(f)
        else:
            log.debug("Ignorado (no es imagen): %s", f.name)
    return resultado


# ===========================================================================
# MÓDULO 4: Matching (nombre de producto ↔ nombre de archivo crudo)
# ===========================================================================

def sanitize_name_for_match(nombre: str) -> str:
    """
    Transforma el nombre de un producto del JSON en una clave de comparación
    robusta que tolera las diferencias entre el JSON y los nombres de archivo.

    Transformaciones aplicadas:
      1. Elimina '/'  (el SO no permite '/' en nombres de archivo)
      2. Elimina puntos de abreviatura (FO.CO → FOCO) — excepto decimales
      3. Colapsa espacios múltiples
      4. MAYÚSCULAS
    """
    s = nombre.replace("/", "")
    s = re.sub(r"(?<!\d)\.(?!\d)", "", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s.upper()


def sanitize_name_alt(nombre: str) -> str:
    """
    Clave alternativa para casos donde el archivo omite también la letra
    que precede a la barra  (p.ej. "L/BRILLANTE" guardado como "BRILLANTE").
    Solo se usa como fallback cuando el match principal falla.
    """
    # Quita patrón  [letra]/ como en  L/BRILLANTE → BRILLANTE
    s = re.sub(r"\b[A-Za-z]/", "", nombre)
    s = s.replace("/", "")
    s = re.sub(r"(?<!\d)\.(?!\d)", "", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s.upper()


def _nombre_logico(archivo: Path) -> str:
    """
    Extrae el 'nombre lógico' de un archivo para usarlo en el matching.

    - Si tiene extensión estándar conocida (.jpg, .webp, .avif, etc.) → usa stem
      Ej: "CABEZA DE LEON.avif"  → "CABEZA DE LEON"
    - Si NO tiene extensión estándar (puede ser sin ext, o con ext rota como
      "PLATO NUM.6 DE 4\" 1/2\"") → usa el nombre completo, sin tocar nada.
      La función sanitize_name_for_match se encargará de normalizar el resultado.
    """
    if archivo.suffix.lower() in EXTS_VALIDAS:
        return archivo.stem
    return archivo.name


def _indice_archivos_crudos(archivos: List[Path]) -> Dict[str, Path]:
    """
    Construye un diccionario {clave_sanitizada: Path} para todos los archivos
    en fotos_crudas/, aplicando sanitize_name_for_match al nombre lógico.
    """
    indice: Dict[str, Path] = {}
    for archivo in archivos:
        clave = sanitize_name_for_match(_nombre_logico(archivo))
        if clave in indice:
            log.warning(
                "Colisión de clave en fotos_crudas: %s vs %s (se usa el primero)",
                indice[clave].name, archivo.name
            )
        else:
            indice[clave] = archivo
    return indice



def resolver_destino(cod: str, plantilla: Dict[str, str]) -> Optional[Path]:
    """
    Determina la ruta final de la imagen en catalogo-web/fotos/.
    Usa la plantilla_fotos.csv como fuente de verdad para el nombre de archivo.
    Fallback: genera nombre a partir del código + .webp.
    """
    nombre_arch = plantilla.get(cod.strip().upper())
    if not nombre_arch:
        # Fallback: cod limpio + .webp
        nombre_arch = re.sub(r"[^\w\-.]", "-", cod).strip("-") + ".webp"
        log.debug("Código %s no encontrado en plantilla, usando fallback: %s", cod, nombre_arch)

    destino = (FOTOS_DIR / nombre_arch).resolve()
    try:
        destino.relative_to(FOTOS_DIR.resolve())   # seguridad: evita path traversal
    except ValueError:
        log.error("Ruta destino insegura para %s: %s", cod, destino)
        return None
    return destino


def construir_matches(
    productos: List[dict],
    archivos_crudos: List[Path],
    plantilla: Dict[str, str],
) -> Tuple[List[Match], List[Path]]:
    """
    Empareja productos sin-foto con imágenes en fotos_crudas/.

    Estrategia de matching (dos pasadas):
      1. Clave primaria: sanitize_name_for_match (quita '/' y puntos)
      2. Clave alternativa: sanitize_name_alt (quita además prefijo letra antes de '/')
         Ejemplo: "CERROJO DOBLE CILINDRO L/BRILLANTE" → "CERROJO DOBLE CILINDRO BRILLANTE"

    Retorna:
      - lista de Match confirmados
      - lista de archivos crudos sin producto correspondiente (huérfanos)
    """
    indice = _indice_archivos_crudos(archivos_crudos)
    archivos_usados: set = set()
    matches: List[Match] = []

    for producto in productos:
        cod = _primer_valor(producto, ("cod", "codigo", "id", "sku"))
        nom = _primer_valor(producto, ("nom", "nombre", "descripcion"))
        if not cod or not nom:
            continue

        # Pasada 1: clave primaria
        clave = sanitize_name_for_match(nom)
        archivo_crudo = indice.get(clave)

        # Pasada 2: clave alternativa (fallback para "L/BRILLANTE" → "BRILLANTE")
        if not archivo_crudo:
            clave_alt = sanitize_name_alt(nom)
            if clave_alt != clave:
                archivo_crudo = indice.get(clave_alt)
                if archivo_crudo:
                    log.debug("Match por clave alternativa: %s → %s", nom, archivo_crudo.name)

        if not archivo_crudo:
            continue

        destino = resolver_destino(cod, plantilla)
        if not destino:
            continue

        matches.append(Match(
            cod=cod,
            nom=nom,
            archivo_crudo=archivo_crudo,
            archivo_destino=destino,
        ))
        archivos_usados.add(archivo_crudo)

    huerfanos = [a for a in archivos_crudos if a not in archivos_usados]
    return matches, huerfanos



# ===========================================================================
# MÓDULO 5: Pipeline de imagen
# ===========================================================================

# Umbral de luminosidad promedio para considerar que las esquinas son "blancas"
# 240/255 ≈ 94% de blanco — tolerante a fondos off-white de catálogos web
UMBRAL_FONDO_BLANCO = 240
# Porcentaje mínimo de la imagen que debe ser claro para confirmar fondo blanco
PORCENTAJE_FONDO_CLARO = 0.85


def tiene_fondo_blanco(imagen: Image.Image) -> bool:
    """
    Detecta si la imagen ya tiene un fondo blanco o muy claro.

    Estrategia robusta (dos criterios combinados):
      1. Las 4 esquinas deben ser blancas/muy claras (cubre fondos sólidos)
      2. El porcentaje de píxeles claros en la imagen debe superar PORCENTAJE_FONDO_CLARO
         (filtra falsos positivos en imágenes con mucho blanco pero fondo oscuro)

    Imágenes de tiendas online, catálogos y fabricantes suelen tener fondo
    blanco puro o muy cercano — rembg en estos casos daña la calidad.
    """
    # Solo aplica a imágenes RGB/L (sin canal alfa ya procesado)
    if imagen.mode == "RGBA":
        return False

    rgb = imagen.convert("RGB")
    w, h = rgb.size

    # Criterio 1: las 4 esquinas son blancas
    esquinas = [
        rgb.getpixel((0, 0)),
        rgb.getpixel((w - 1, 0)),
        rgb.getpixel((0, h - 1)),
        rgb.getpixel((w - 1, h - 1)),
    ]
    esquinas_blancas = all(
        sum(px) / 3 >= UMBRAL_FONDO_BLANCO for px in esquinas
    )
    if not esquinas_blancas:
        return False

    # Criterio 2: la mayor parte de la imagen es clara
    gris = rgb.convert("L")
    total = w * h
    pixeles_claros = sum(1 for px in gris.getdata() if px >= UMBRAL_FONDO_BLANCO)
    return (pixeles_claros / total) >= PORCENTAJE_FONDO_CLARO


def _pipeline_con_fondo(imagen: Image.Image) -> Image.Image:
    """
    Ruta RÁPIDA para imágenes que ya tienen fondo blanco.
    Solo centra y redimensiona — no aplica rembg para preservar calidad original.
    """
    rgb = imagen.convert("RGB")
    rgb.thumbnail(PRODUCT_MAX_SIZE, RESAMPLE)

    canvas = Image.new("RGB", CANVAS_SIZE, (255, 255, 255))
    x = (CANVAS_SIZE[0] - rgb.width)  // 2
    y = (CANVAS_SIZE[1] - rgb.height) // 2
    canvas.paste(rgb, (x, y))
    return canvas


def _pipeline_sin_fondo(datos: bytes, imagen_orig: Image.Image, sesion_ia) -> Image.Image:
    """
    Ruta COMPLETA para imágenes con fondo no blanco.
    Aplica rembg → recorte con margen → canvas blanco 800×800.
    """
    try:
        resultado_bytes = remove(datos, session=sesion_ia)
        sin_fondo = Image.open(BytesIO(resultado_bytes)).convert("RGBA")
        if not sin_fondo.getchannel("A").getbbox():
            log.debug("rembg devolvió canal alfa vacío, usando imagen original")
            sin_fondo = imagen_orig.convert("RGBA")
    except Exception as exc:
        log.debug("rembg falló (%s), usando imagen original", exc)
        sin_fondo = imagen_orig.convert("RGBA")

    # Recortar al bounding-box del producto
    alpha = sin_fondo.getchannel("A")
    mascara = alpha.point(lambda p: 255 if p > ALPHA_THRESHOLD else 0)
    bbox = mascara.getbbox()
    if bbox:
        l = max(0, bbox[0] - CROP_MARGIN_PX)
        t = max(0, bbox[1] - CROP_MARGIN_PX)
        r = min(sin_fondo.width,  bbox[2] + CROP_MARGIN_PX)
        b = min(sin_fondo.height, bbox[3] + CROP_MARGIN_PX)
        sin_fondo = sin_fondo.crop((l, t, r, b))

    sin_fondo.thumbnail(PRODUCT_MAX_SIZE, RESAMPLE)

    canvas = Image.new("RGBA", CANVAS_SIZE, BG_COLOR)
    x = (CANVAS_SIZE[0] - sin_fondo.width)  // 2
    y = (CANVAS_SIZE[1] - sin_fondo.height) // 2
    canvas.alpha_composite(sin_fondo, (x, y))
    return canvas.convert("RGB")


def estandarizar_imagen(ruta: Path, sesion_ia) -> tuple:
    """
    Pipeline inteligente de estandarización:

    RUTA A — Imagen con fondo blanco detectado (catálogos, tiendas online):
      → Solo centra y redimensiona en canvas 800×800. No aplica rembg.
      → Preserva la calidad original del fabricante.

    RUTA B — Imagen con fondo de color / fotografía / fondo mixto:
      → rembg elimina el fondo → recorte al producto → canvas 800×800 blanco.

    Retorna (imagen_PIL, ruta_usada: str) para informar en el log.
    """
    datos = ruta.read_bytes()
    imagen_orig = Image.open(BytesIO(datos))

    if imagen_orig.width < MIN_EDGE_PX or imagen_orig.height < MIN_EDGE_PX:
        raise ValueError(
            f"Imagen demasiado pequeña: {imagen_orig.width}×{imagen_orig.height}px "
            f"(mínimo {MIN_EDGE_PX}px por lado)"
        )

    if tiene_fondo_blanco(imagen_orig):
        return _pipeline_con_fondo(imagen_orig), "fondo-blanco→solo-centrar"
    else:
        return _pipeline_sin_fondo(datos, imagen_orig, sesion_ia), "fondo-color→rembg"


# ===========================================================================
# MÓDULO 6: Writer de salida
# ===========================================================================

def guardar_imagen(imagen: Image.Image, destino: Path) -> Path:
    """
    Guarda la imagen en el destino indicado por plantilla_fotos.csv.
    Siempre sobreescribe (primera vuelta).
    Devuelve la ruta real donde se guardó.
    """
    destino.parent.mkdir(parents=True, exist_ok=True)
    ext = destino.suffix.lower()

    if ext in (".jpg", ".jpeg"):
        imagen.save(destino, "JPEG", quality=92, optimize=True, progressive=True)
    elif ext == ".png":
        imagen.save(destino, "PNG", optimize=True)
    else:
        # WebP es el formato estándar del catálogo; si la extensión es extraña,
        # forzar a .webp igualmente
        destino = destino.with_suffix(".webp")
        imagen.save(destino, "WEBP", quality=88, method=6)

    return destino


# ===========================================================================
# MÓDULO 7: Reporter
# ===========================================================================

def escribir_reporte(resultados: List[Resultado], huerfanos: List[Path], path: Path) -> None:
    """Escribe el CSV de auditoría con resultados y archivos huérfanos."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=["cod", "nom", "archivo_crudo", "archivo_destino", "estado", "detalle"],
        )
        writer.writeheader()
        for r in resultados:
            writer.writerow(r.__dict__)
        # Registrar huérfanos como filas informativas
        for h in huerfanos:
            writer.writerow({
                "cod": "", "nom": "", "archivo_crudo": h.name,
                "archivo_destino": "", "estado": "huerfano",
                "detalle": "Archivo en fotos_crudas sin producto correspondiente",
            })
    log.info("Reporte guardado en: %s", path)


def imprimir_resumen(resultados: List[Resultado], huerfanos: List[Path]) -> None:
    conteo: Dict[str, int] = {}
    for r in resultados:
        conteo[r.estado] = conteo.get(r.estado, 0) + 1
    linea = " | ".join(f"{k}={v}" for k, v in sorted(conteo.items()))
    log.info("=" * 60)
    log.info("Resumen: %s | huerfanos=%d", linea, len(huerfanos))
    if huerfanos:
        log.info("Archivos sin match en fotos_crudas:")
        for h in huerfanos:
            log.info("  ⚠  %s", h.name)
    log.info("=" * 60)


# ===========================================================================
# MÓDULO 8: CLI y punto de entrada
# ===========================================================================

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description=(
            "Estandariza imágenes crudas de pipeline/fotos_crudas/ y las guarda\n"
            "en catalogo-web/fotos/ con la nomenclatura de plantilla_fotos.csv.\n\n"
            "Sin --apply sólo muestra qué haría (simulación segura)."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument(
        "--apply",
        action="store_true",
        help="Ejecuta el pipeline y sobreescribe las imágenes de destino.",
    )
    p.add_argument(
        "--limit",
        type=int,
        default=0,
        metavar="N",
        help="Procesa solo los primeros N matches (0 = todos).",
    )
    p.add_argument(
        "--reporte",
        type=Path,
        default=REPORTE_CSV,
        help=f"Ruta del CSV de auditoría. Default: {REPORTE_CSV}",
    )
    p.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Activa logs de depuración.",
    )
    return p.parse_args()


def main() -> int:
    args = parse_args()

    if args.verbose:
        log.setLevel(logging.DEBUG)

    log.info("=" * 60)
    log.info("Pipeline: Fotos Crudas → Catálogo")
    log.info("Fuente  : %s", FOTOS_CRUDAS)
    log.info("Destino : %s", FOTOS_DIR)
    log.info("Modo    : %s", "APLICAR" if args.apply else "SIMULACIÓN (dry-run)")
    log.info("=" * 60)

    # ── Carga de datos ──────────────────────────────────────────────────────
    productos    = cargar_productos_sin_foto()
    plantilla    = cargar_plantilla()
    fotos_crudas = listar_fotos_crudas()

    log.info("Productos sin-foto en JSON : %d", len(productos))
    log.info("Imágenes en fotos_crudas/  : %d", len(fotos_crudas))
    log.info("(Huérfanos esperados = fotos ya aprobadas que quedan como histórico)")

    # ── Matching ────────────────────────────────────────────────────────────
    matches, huerfanos = construir_matches(productos, fotos_crudas, plantilla)

    if args.limit > 0:
        matches = matches[:args.limit]

    log.info("Matches encontrados        : %d", len(matches))
    log.info("Archivos huérfanos (sin match): %d", len(huerfanos))

    # ── Modo simulación ─────────────────────────────────────────────────────
    if not args.apply:
        log.info("")
        log.info("──── PLAN DE EJECUCIÓN (simulación) ────")
        for m in matches:
            log.info(
                "  %-25s  %s  →  %s",
                m.cod, m.archivo_crudo.name, m.archivo_destino.name,
            )
        if huerfanos:
            log.info("")
            log.info("──── ARCHIVOS SIN MATCH ────")
            for h in huerfanos:
                log.info("  ⚠  %s", h.name)
        log.info("")
        log.info("Agrega --apply para ejecutar el pipeline.")
        return 0

    # ── Pipeline real ────────────────────────────────────────────────────────
    log.info("Cargando modelo de IA para recorte de fondo (u2net)...")
    sesion_ia = new_session("u2net")
    log.info("Modelo listo. Iniciando procesamiento...")

    resultados: List[Resultado] = []

    for idx, match in enumerate(matches, 1):
        prefix = f"[{idx}/{len(matches)}]"
        log.info("%s %s | %s", prefix, match.cod, match.nom[:55])

        try:
            imagen, ruta_usada = estandarizar_imagen(match.archivo_crudo, sesion_ia)
            ruta_guardada = guardar_imagen(imagen, match.archivo_destino)
            resultados.append(Resultado(
                cod=match.cod,
                nom=match.nom,
                archivo_crudo=match.archivo_crudo.name,
                archivo_destino=ruta_guardada.name,
                estado="ok",
                detalle=f"{ruta_usada} | guardado en {ruta_guardada}",
            ))
            log.info("%s ✓ OK [%s] → %s", prefix, ruta_usada, ruta_guardada.name)

        except Exception as exc:
            resultados.append(Resultado(
                cod=match.cod,
                nom=match.nom,
                archivo_crudo=match.archivo_crudo.name,
                archivo_destino=match.archivo_destino.name,
                estado="error",
                detalle=str(exc),
            ))
            log.error("%s ✗ ERROR: %s", prefix, exc)

    # ── Reporte y resumen ────────────────────────────────────────────────────
    escribir_reporte(resultados, huerfanos, args.reporte)
    imprimir_resumen(resultados, huerfanos)
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
