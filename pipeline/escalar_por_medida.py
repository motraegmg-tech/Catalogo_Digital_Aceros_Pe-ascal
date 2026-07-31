#!/usr/bin/env python3
"""
escalar_por_medida.py — Escala relativa de imágenes de productos similares.

Para grupos de productos del mismo proveedor/familia que comparten la misma
imagen pero difieren solo en sus medidas (ej: tensores 6", 9", 12"), este
script ajusta el tamaño visual del producto dentro del canvas 800×800
de forma proporcional a sus dimensiones físicas.

Principio:
  - El canvas siempre mide 800×800 px (no cambia).
  - El producto más grande del grupo ocupa el área máxima (700×700 px).
  - Los productos más pequeños se reducen proporcionalmente según su medida.

Módulos:
  1. Configuración y constantes
  2. Tipos de datos
  3. Extracción de medidas (del campo 'med' del JSON)
  4. Detección de grupos similares
  5. Pipeline de escalado relativo
  6. Reporter (log de auditoría)
  7. CLI y main

Uso:
  # Simulación (muestra grupos detectados sin modificar nada):
  python3 pipeline/escalar_por_medida.py

  # Aplicar cambios:
  python3 pipeline/escalar_por_medida.py --apply

  # Escalar un grupo específico de códigos:
  python3 pipeline/escalar_por_medida.py --apply --codigos TEN36AA TEN39 TEN412

  # Especificar medida de referencia máxima distinta:
  python3 pipeline/escalar_por_medida.py --apply --codigos TEN36AA TEN39 TEN412 --max-medida 12

  # Verbose para depuración:
  python3 pipeline/escalar_por_medida.py --verbose
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import math
import re

# Alias: este script ya tiene su propia cargar_productos() que devuelve
# objetos Producto, así que el cargador compartido entra con otro nombre.
from catalogo_fuente import cargar_productos as cargar_catalogo
import sys
from dataclasses import dataclass, field
from io import BytesIO
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

try:
    from PIL import Image
except ImportError as exc:
    sys.exit(
        f"[FATAL] Dependencia faltante: {exc}\n"
        "Ejecuta: source pipeline/venv_fotos/bin/activate"
    )

# ===========================================================================
# MÓDULO 1: Configuración y constantes
# ===========================================================================

BASE_DIR       = Path(__file__).resolve().parent
ROOT_DIR       = BASE_DIR.parent

PRODUCTOS_JSON = ROOT_DIR / "catalogo-web" / "data" / "productos.json"
FOTOS_DIR      = ROOT_DIR / "catalogo-web" / "fotos"
LOG_DIR        = ROOT_DIR / "datos"
LOG_PATH       = LOG_DIR / "escalar_por_medida_log.csv"

CANVAS_SIZE    = (800, 800)          # tamaño fijo del canvas — no cambia
MAX_AREA_PX    = 700                 # lado máximo para el producto más grande
MIN_AREA_PX    = 150                 # lado mínimo (evita productos invisibles)
RESAMPLE       = getattr(Image, "Resampling", Image).LANCZOS
BG_COLOR       = (255, 255, 255)     # fondo blanco

logging.basicConfig(
    format="%(asctime)s %(levelname)-8s %(message)s",
    datefmt="%H:%M:%S",
    level=logging.INFO,
    stream=sys.stdout,
)
log = logging.getLogger("escalar_por_medida")


# ===========================================================================
# MÓDULO 2: Tipos de datos
# ===========================================================================

@dataclass
class Producto:
    cod:  str
    nom:  str
    foto: str           # nombre de archivo en catalogo-web/fotos/
    med:  str           # valor raw del campo 'med' del JSON
    prov: str           # proveedor (para agrupar)


@dataclass
class ItemEscala:
    """Un producto con su medida numérica resuelta y el factor de escala calculado."""
    producto:      Producto
    medida_px:     float    # longitud física máxima en unidades consistentes
    factor:        float    # factor de escala relativo al máximo del grupo (0..1]
    lado_destino:  int      # píxeles del lado del producto en el canvas de salida
    ruta_foto:     Path     # ruta real de la imagen en FOTOS_DIR


@dataclass
class ResultadoEscala:
    cod:          str
    nom:          str
    foto:         str
    medida_raw:   str
    medida_px:    float
    factor:       float
    lado_destino: int
    estado:       str   # ok | skip | error
    detalle:      str


# ===========================================================================
# MÓDULO 3: Extracción de medidas físicas
# ===========================================================================

# ── Patrones de extracción de medidas ─────────────────────────────────────
#  Acepta: 1/2"  5/8"  12"  1.5"  3/8  25mm  1.25  etc.
#  Devuelve el valor en pulgadas (o en la unidad que sea, de forma consistente)
_RE_FRACCION  = re.compile(r'(\d+)\s*/\s*(\d+)')          # 1/2  5/16
_RE_DECIMAL   = re.compile(r'(\d+(?:\.\d+)?)')             # 12  1.5  6
_RE_MM        = re.compile(r'(\d+(?:\.\d+)?)\s*mm', re.I)  # 25mm  12.5mm


def _fraccion_a_decimal(texto: str) -> float:
    """Convierte '1/2', '5/8', '3/16' etc. a float."""
    m = _RE_FRACCION.search(texto)
    if m:
        return int(m.group(1)) / int(m.group(2))
    return 0.0


def _extraer_numeros_de_texto(texto: str) -> List[float]:
    """
    Extrae todos los valores numéricos de un texto de medidas.
    Prioriza fracciones (1/2) sobre enteros (1, 2).
    Convierte mm a pulgadas para unidades consistentes (1 mm ≈ 0.03937").

    Ejemplos:
      '1/2" 6"'      → [0.5, 6.0]
      '5/8" 12"'     → [0.625, 12.0]
      '25mm'         → [0.984]
      '1/4"'         → [0.25]
    """
    resultados: List[float] = []
    resto = texto

    # 1. Extraer mm primero (para no confundirlos con pulgadas)
    for m in _RE_MM.finditer(texto):
        pulgadas = float(m.group(1)) / 25.4
        resultados.append(pulgadas)
        # Reemplazar el trozo consumido con espacios para que no lo re-procesen
        resto = resto.replace(m.group(0), " " * len(m.group(0)), 1)

    # 2. Extraer fracciones (p.ej. 1/2, 5/8, 3/16)
    for m in _RE_FRACCION.finditer(resto):
        valor = int(m.group(1)) / int(m.group(2))
        resultados.append(valor)
        resto = resto.replace(m.group(0), " " * len(m.group(0)), 1)

    # 3. Extraer enteros/decimales restantes
    for m in _RE_DECIMAL.finditer(resto):
        resultados.append(float(m.group(1)))

    return resultados


def medida_maxima(med_raw: str) -> float:
    """
    Retorna la dimensión física más grande encontrada en el campo 'med'.
    Esa dimensión es la que determina el tamaño visual relativo del producto.

    Ejemplos:
      '1/2" 6" 1/2'  → 6.0   (la longitud más grande)
      '5/8" 12"'     → 12.0
      '3/8" 3/8'     → 0.375
      '25mm'         → 0.984
    """
    if not med_raw:
        return 0.0
    numeros = _extraer_numeros_de_texto(med_raw)
    return max(numeros) if numeros else 0.0


def medida_desde_nombre(nom: str) -> float:
    """
    Fallback: extrae la medida máxima del nombre del producto cuando
    el campo 'med' está vacío.
    Solo se usa si 'med' no contiene datos útiles.
    """
    return medida_maxima(nom)


# ===========================================================================
# MÓDULO 4: Detección de grupos similares
# ===========================================================================

def _clave_grupo(producto: Producto) -> str:
    """
    Genera una clave de grupo basada en el proveedor + nombre base
    (con las medidas eliminadas) para agrupar productos relacionados.

    Ejemplo:
      'TENSOR DE ACERO SURTEK 1/2" X 6" (TEN36AA)' → 'TENSOR DE ACERO SURTEK X'
    """
    nom = producto.nom.upper()
    # Eliminar medidas del nombre: fracciones, pulgadas, decimales y " X "
    nom = re.sub(r'\d+/\d+"\s*', '', nom)          # 1/2"  5/8"
    nom = re.sub(r'\d+(?:\.\d+)?"', '', nom)        # 12"  6"
    nom = re.sub(r'\d+(?:\.\d+)?\s*MM', '', nom)    # 25MM
    nom = re.sub(r'\d+(?:\.\d+)?', '', nom)         # otros números
    nom = re.sub(r'\(.*?\)', '', nom)               # (codigo) entre paréntesis
    nom = re.sub(r'\s+', ' ', nom).strip()
    # Incluir proveedor para no mezclar productos similares de proveedores distintos
    prov_clave = re.sub(r'\s+', '_', producto.prov.upper()[:30])
    return f"{prov_clave}|{nom}"


def agrupar_productos(productos: List[Producto]) -> Dict[str, List[Producto]]:
    """
    Agrupa los productos por familia (nombre base + proveedor).
    Solo retorna grupos con ≥2 productos (los grupos de 1 no necesitan escala relativa).
    """
    grupos: Dict[str, List[Producto]] = {}
    for p in productos:
        clave = _clave_grupo(p)
        grupos.setdefault(clave, []).append(p)
    return {k: v for k, v in grupos.items() if len(v) >= 2}


# ===========================================================================
# MÓDULO 5: Pipeline de escalado relativo
# ===========================================================================

def calcular_escalas(
    grupo: List[Producto],
    medida_max_override: Optional[float] = None,
) -> List[ItemEscala]:
    """
    Calcula los factores de escala para un grupo de productos.

    Lógica:
      1. Determina la medida física de cada producto (campo 'med' o fallback al nombre).
      2. El producto con la medida más grande → factor=1.0, lado=MAX_AREA_PX.
      3. Los demás → factor proporcional, usando raíz cuadrada para que la diferencia
         visual sea perceptible pero no extrema (área proporcional a la medida).
      4. El lado mínimo está limitado a MIN_AREA_PX para que ningún producto
         quede demasiado pequeño.

    medida_max_override: si se especifica, esta es la medida de referencia del
      producto más grande (útil cuando el grupo está incompleto).
    """
    items: List[ItemEscala] = []

    for p in grupo:
        medida = medida_maxima(p.med) if p.med else 0.0
        if medida == 0.0:
            medida = medida_desde_nombre(p.nom)

        ruta_foto = FOTOS_DIR / p.foto
        items.append(ItemEscala(
            producto=p,
            medida_px=medida,
            factor=1.0,         # se recalcula abajo
            lado_destino=MAX_AREA_PX,
            ruta_foto=ruta_foto,
        ))

    max_medida = medida_max_override or max(i.medida_px for i in items)

    if max_medida == 0.0:
        log.warning("No se pudo extraer medida para el grupo: %s", [p.nom for p in grupo])
        return items

    for item in items:
        if item.medida_px == 0.0:
            log.warning("Medida 0 para %s (%s), se omitirá.", item.producto.cod, item.producto.nom)
            item.factor = 0.0
            item.lado_destino = 0
            continue

        # Escala por raíz cuadrada: percepción de área más intuitiva que escala lineal.
        # Lineal haría que un 6" sea 50% de un 12", lo que resulta en un producto
        # visualmente muy pequeño y la diferencia deja de ser perceptible.
        # Con raíz cuadrada: factor = sqrt(medida / max_medida)
        factor = math.sqrt(item.medida_px / max_medida)
        lado = max(MIN_AREA_PX, int(MAX_AREA_PX * factor))
        item.factor = round(factor, 4)
        item.lado_destino = lado

    return items


def _centrar_en_canvas(imagen: Image.Image, lado_destino: int) -> Image.Image:
    """
    1. Extrae el producto del fondo blanco (bounding box del contenido no-blanco).
    2. Redimensiona el producto al tamaño lado_destino × lado_destino como máximo.
    3. Centra el resultado en un canvas 800×800 con fondo blanco.
    """
    # Convertir a RGB si tiene canal alfa
    if imagen.mode == "RGBA":
        fondo = Image.new("RGBA", imagen.size, (255, 255, 255, 255))
        fondo.alpha_composite(imagen)
        imagen = fondo.convert("RGB")
    else:
        imagen = imagen.convert("RGB")

    # Detectar bounding box del contenido (no-blanco)
    gris = imagen.convert("L")
    # Umbral: píxeles más oscuros que 250 son "producto"
    mascara = gris.point(lambda px: 0 if px >= 250 else 255)
    bbox = mascara.getbbox()

    if bbox:
        # Expandir ligeramente el bbox para no cortar bordes finos
        margen = 4
        l = max(0, bbox[0] - margen)
        t = max(0, bbox[1] - margen)
        r = min(imagen.width, bbox[2] + margen)
        b = min(imagen.height, bbox[3] + margen)
        recorte = imagen.crop((l, t, r, b))
    else:
        recorte = imagen

    # Redimensionar proporcionalmente dentro del cuadrado lado_destino × lado_destino
    recorte.thumbnail((lado_destino, lado_destino), RESAMPLE)

    # Canvas 800×800 blanco
    canvas = Image.new("RGB", CANVAS_SIZE, BG_COLOR)
    x = (CANVAS_SIZE[0] - recorte.width)  // 2
    y = (CANVAS_SIZE[1] - recorte.height) // 2
    canvas.paste(recorte, (x, y))
    return canvas


def procesar_item(item: ItemEscala, apply: bool) -> ResultadoEscala:
    """
    Procesa un solo ItemEscala: carga la imagen, la escala y (si apply=True) la guarda.
    """
    base = dict(
        cod=item.producto.cod,
        nom=item.producto.nom,
        foto=item.producto.foto,
        medida_raw=item.producto.med,
        medida_px=item.medida_px,
        factor=item.factor,
        lado_destino=item.lado_destino,
    )

    if item.factor == 0.0:
        return ResultadoEscala(
            **base, estado="skip",
            detalle="Medida 0: no se puede calcular escala relativa."
        )

    if not item.ruta_foto.exists():
        return ResultadoEscala(
            **base, estado="skip",
            detalle=f"Foto no encontrada: {item.ruta_foto}"
        )

    if not apply:
        return ResultadoEscala(
            **base, estado="simulacion",
            detalle=f"Se re-escalaría a {item.lado_destino}px en canvas 800×800"
        )

    try:
        with Image.open(item.ruta_foto) as img:
            resultado = _centrar_en_canvas(img, item.lado_destino)

        # Guardar como WebP (mismo nombre, sobreescribe)
        resultado.save(item.ruta_foto, "WEBP", quality=88, method=6)

        return ResultadoEscala(
            **base, estado="ok",
            detalle=f"Guardado con lado_destino={item.lado_destino}px (factor={item.factor})"
        )
    except Exception as exc:
        return ResultadoEscala(
            **base, estado="error",
            detalle=str(exc)
        )


# ===========================================================================
# MÓDULO 6: Reporter
# ===========================================================================

def escribir_log(resultados: List[ResultadoEscala], path: Path) -> None:
    """Escribe el log CSV de auditoría con todos los productos modificados."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        "cod", "nom", "foto", "medida_raw", "medida_px",
        "factor", "lado_destino", "estado", "detalle"
    ]
    with path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for r in resultados:
            writer.writerow(r.__dict__)
    log.info("Log guardado en: %s", path)


def imprimir_resumen(
    grupos: Dict[str, List[Producto]],
    resultados: List[ResultadoEscala],
    apply: bool,
) -> None:
    log.info("=" * 70)
    log.info("Grupos detectados          : %d", len(grupos))
    log.info("Total productos procesados : %d", len(resultados))

    conteo: Dict[str, int] = {}
    for r in resultados:
        conteo[r.estado] = conteo.get(r.estado, 0) + 1
    linea = " | ".join(f"{k}={v}" for k, v in sorted(conteo.items()))
    log.info("Resultados                 : %s", linea)

    if not apply:
        log.info("")
        log.info("► Ejecuta con --apply para realizar los cambios.")

    log.info("=" * 70)

    # Mostrar grupos detectados con sus medidas
    log.info("")
    log.info("──── GRUPOS DETECTADOS ────")
    for clave, miembros in sorted(grupos.items()):
        log.info("")
        # Extraer nombre legible de la clave
        nombre_grupo = clave.split("|", 1)[-1].strip()
        log.info("  Grupo: %s", nombre_grupo)
        for p in sorted(miembros, key=lambda x: medida_maxima(x.med)):
            m = medida_maxima(p.med) if p.med else medida_desde_nombre(p.nom)
            log.info("    %-15s  med=%-8.3f  %s", p.cod, m, p.nom[:60])


def imprimir_modificados(resultados: List[ResultadoEscala]) -> None:
    """Imprime la lista exacta de productos modificados (para revisión manual)."""
    modificados = [r for r in resultados if r.estado == "ok"]
    if not modificados:
        return

    log.info("")
    log.info("══════════════════════════════════════════════════════════════════════")
    log.info("PRODUCTOS MODIFICADOS — revisa manualmente en el catálogo:")
    log.info("══════════════════════════════════════════════════════════════════════")
    for r in modificados:
        log.info(
            "  %-15s  factor=%-6.3f  lado=%dpx  %s",
            r.cod, r.factor, r.lado_destino, r.nom[:55]
        )
    log.info("══════════════════════════════════════════════════════════════════════")
    log.info("Total modificados: %d", len(modificados))


# ===========================================================================
# MÓDULO 7: CLI y main
# ===========================================================================

def cargar_productos() -> List[Producto]:
    """
    Devuelve todos los productos que tienen foto.

    La fuente es Supabase (con respaldo al archivo local si no hay red): las
    medidas se editan desde el clasificador y este script escala segun ellas,
    asi que leer del archivo del repositorio podia escalar con medidas viejas.
    """
    result: List[Producto] = []
    for p in cargar_catalogo():
        foto = (p.get("foto") or "").strip()
        cod  = (p.get("cod") or p.get("id") or "").strip()
        nom  = (p.get("nom") or p.get("nombre") or "").strip()
        med  = (p.get("med") or "").strip()
        prov = (p.get("prov") or "").strip()
        if foto and cod and nom:
            result.append(Producto(cod=cod, nom=nom, foto=foto, med=med, prov=prov))
    return result


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description=(
            "Escala imágenes de productos hermanos proporcionalmente a su medida física.\n"
            "El canvas siempre permanece 800×800 px.\n\n"
            "Sin --apply solo muestra la simulación (seguro).\n"
            "Usa --codigos para procesar solo un grupo específico."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument(
        "--apply",
        action="store_true",
        help="Aplica los cambios y sobreescribe las imágenes.",
    )
    p.add_argument(
        "--codigos",
        nargs="+",
        metavar="COD",
        help=(
            "Lista de códigos de productos a procesar (sobreescribe la detección automática). "
            "Ejemplo: --codigos TEN36AA TEN39 TEN412"
        ),
    )
    p.add_argument(
        "--max-medida",
        type=float,
        default=None,
        dest="max_medida",
        metavar="N",
        help=(
            "Medida de referencia máxima (en la unidad del campo 'med'). "
            "Si no se especifica, se usa el máximo detectado dentro del grupo."
        ),
    )
    p.add_argument(
        "--log",
        type=Path,
        default=LOG_PATH,
        help=f"Ruta del CSV de auditoría. Default: {LOG_PATH}",
    )
    p.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Activa logs de depuración.",
    )
    return p.parse_args()


def _resolver_grupos_codigos(
    codigos: List[str],
    todos_productos: List[Producto],
    max_medida: Optional[float],
) -> Dict[str, List[Producto]]:
    """
    Cuando el usuario especifica --codigos, construye un único grupo manual
    con esos productos y los trata como una sola familia.
    """
    cod_set = {c.upper() for c in codigos}
    miembros = [p for p in todos_productos if p.cod.upper() in cod_set]

    faltantes = cod_set - {p.cod.upper() for p in miembros}
    if faltantes:
        log.warning("Códigos no encontrados en productos.json: %s", faltantes)

    if len(miembros) < 2:
        log.error("Se necesitan al menos 2 productos para calcular escala relativa.")
        return {}

    return {"MANUAL": miembros}


def main() -> int:
    args = parse_args()

    if args.verbose:
        log.setLevel(logging.DEBUG)

    log.info("=" * 70)
    log.info("Escalar por Medida — Pipeline de escala relativa")
    log.info("Canvas fijo: %dx%d px | Producto máx: %dpx | Producto mín: %dpx",
             CANVAS_SIZE[0], CANVAS_SIZE[1], MAX_AREA_PX, MIN_AREA_PX)
    log.info("Modo: %s", "APLICAR" if args.apply else "SIMULACIÓN (dry-run)")
    log.info("=" * 70)

    # ── Carga ────────────────────────────────────────────────────────────────
    todos_productos = cargar_productos()
    log.info("Productos con foto cargados: %d", len(todos_productos))

    # ── Agrupación ───────────────────────────────────────────────────────────
    if args.codigos:
        grupos = _resolver_grupos_codigos(args.codigos, todos_productos, args.max_medida)
    else:
        grupos = agrupar_productos(todos_productos)

    if not grupos:
        log.info("No se encontraron grupos de productos similares.")
        return 0

    # ── Cálculo de escalas y procesamiento ───────────────────────────────────
    todos_resultados: List[ResultadoEscala] = []

    for clave, miembros in grupos.items():
        nombre_grupo = clave.split("|", 1)[-1].strip()
        log.info("")
        log.info("  Procesando grupo: %s  (%d productos)", nombre_grupo, len(miembros))

        items = calcular_escalas(miembros, medida_max_override=args.max_medida)

        for item in items:
            resultado = procesar_item(item, args.apply)
            todos_resultados.append(resultado)

            simbolo = {"ok": "✓", "skip": "○", "error": "✗", "simulacion": "→"}.get(
                resultado.estado, "?"
            )
            log.info(
                "    %s %-15s  med=%-6.3f  factor=%-6.3f  lado=%dpx  %s",
                simbolo, resultado.cod, resultado.medida_px,
                resultado.factor, resultado.lado_destino,
                resultado.nom[:45],
            )

    # ── Reporte ───────────────────────────────────────────────────────────────
    escribir_log(todos_resultados, args.log)
    imprimir_resumen(grupos, todos_resultados, args.apply)
    imprimir_modificados(todos_resultados)

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
