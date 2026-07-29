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

# Extensiones de imagen aceptadas en fotos_crudas
EXTS_VALIDAS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff"}

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
    """Lee productos.json y devuelve solo los marcados con 'sin-foto'. NUNCA lo modifica."""
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


def listar_fotos_crudas() -> List[Path]:
    """Devuelve todas las imágenes en fotos_crudas/ con extensión válida."""
    if not FOTOS_CRUDAS.exists():
        raise FileNotFoundError(f"Carpeta no encontrada: {FOTOS_CRUDAS}")
    return [f for f in FOTOS_CRUDAS.iterdir() if f.suffix.lower() in EXTS_VALIDAS]


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


def _indice_archivos_crudos(archivos: List[Path]) -> Dict[str, Path]:
    """
    Construye un diccionario {clave_sanitizada: Path} para todos los archivos
    en fotos_crudas/, aplicando la misma función sanitize al stem del archivo.
    """
    indice: Dict[str, Path] = {}
    for archivo in archivos:
        clave = sanitize_name_for_match(archivo.stem)
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

def _tiene_fondo_uniforme(imagen: Image.Image) -> bool:
    """
    Heurística: detecta si la imagen ya tiene un fondo blanco/sólido uniforme
    verificando las esquinas. Si es así, rembg puede ser más agresivo de lo necesario.
    No afecta el procesamiento — siempre aplicamos el pipeline completo.
    """
    if imagen.mode == "RGBA":
        return False   # si ya tiene canal alfa, rembg fue aplicado antes
    w, h = imagen.size
    puntos = [
        imagen.getpixel((0, 0)),
        imagen.getpixel((w - 1, 0)),
        imagen.getpixel((0, h - 1)),
        imagen.getpixel((w - 1, h - 1)),
    ]
    # Todos blancos o muy claros
    return all(
        (sum(p[:3]) / 3 > 230 if isinstance(p, tuple) else p > 230)
        for p in puntos
    )


def remover_fondo(datos: bytes, sesion_ia) -> Image.Image:
    """
    Elimina el fondo con rembg. Si el resultado pierde el producto
    (bbox vacío), devuelve la imagen original sin fondo aplicado.
    """
    imagen_original = Image.open(BytesIO(datos)).convert("RGBA")

    try:
        resultado_bytes = remove(datos, session=sesion_ia)
        sin_fondo = Image.open(BytesIO(resultado_bytes)).convert("RGBA")
        if sin_fondo.getchannel("A").getbbox():
            return sin_fondo
        log.debug("rembg devolvió canal alfa vacío, usando imagen original")
    except Exception as exc:
        log.debug("rembg falló: %s — usando imagen original", exc)

    return imagen_original


def recortar_producto(imagen: Image.Image) -> Image.Image:
    """
    Recorta al bounding-box del producto con un margen de seguridad.
    Trabaja sobre el canal alfa para imágenes con fondo removido,
    o sobre luminosidad para imágenes sin canal alfa.
    """
    if imagen.mode != "RGBA":
        imagen = imagen.convert("RGBA")

    alpha = imagen.getchannel("A")
    mascara = alpha.point(lambda p: 255 if p > ALPHA_THRESHOLD else 0)
    bbox = mascara.getbbox()
    if not bbox:
        return imagen   # no se puede recortar, devolver intacta

    l = max(0, bbox[0] - CROP_MARGIN_PX)
    t = max(0, bbox[1] - CROP_MARGIN_PX)
    r = min(imagen.width,  bbox[2] + CROP_MARGIN_PX)
    b = min(imagen.height, bbox[3] + CROP_MARGIN_PX)
    return imagen.crop((l, t, r, b))


def componer_canvas(imagen: Image.Image) -> Image.Image:
    """
    Centra el producto (con transparencia) sobre un canvas 800×800 blanco sólido.
    Redimensiona manteniendo proporción para que quepa en PRODUCT_MAX_SIZE.
    """
    if imagen.mode != "RGBA":
        imagen = imagen.convert("RGBA")

    imagen.thumbnail(PRODUCT_MAX_SIZE, RESAMPLE)

    canvas = Image.new("RGBA", CANVAS_SIZE, BG_COLOR)
    x = (CANVAS_SIZE[0] - imagen.width)  // 2
    y = (CANVAS_SIZE[1] - imagen.height) // 2
    canvas.alpha_composite(imagen, (x, y))
    return canvas.convert("RGB")


def estandarizar_imagen(ruta: Path, sesion_ia) -> Image.Image:
    """
    Pipeline completo de estandarización:
      1. Leer archivo crudo
      2. Validar tamaño mínimo
      3. Remover fondo (rembg)
      4. Recortar al producto con margen
      5. Centrar en canvas 800×800 fondo blanco
    """
    datos = ruta.read_bytes()
    img_check = Image.open(BytesIO(datos))
    if img_check.width < MIN_EDGE_PX or img_check.height < MIN_EDGE_PX:
        raise ValueError(
            f"Imagen demasiado pequeña: {img_check.width}×{img_check.height}px "
            f"(mínimo {MIN_EDGE_PX}px por lado)"
        )

    imagen = remover_fondo(datos, sesion_ia)
    imagen = recortar_producto(imagen)
    return componer_canvas(imagen)


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
            imagen = estandarizar_imagen(match.archivo_crudo, sesion_ia)
            ruta_guardada = guardar_imagen(imagen, match.archivo_destino)
            resultados.append(Resultado(
                cod=match.cod,
                nom=match.nom,
                archivo_crudo=match.archivo_crudo.name,
                archivo_destino=ruta_guardada.name,
                estado="ok",
                detalle=f"Guardado en {ruta_guardada}",
            ))
            log.info("%s ✓ OK → %s", prefix, ruta_guardada.name)

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
