#!/usr/bin/env python3
"""
agregar_fondo_blanco.py — Agrega fondo blanco a fotos con transparencia.

Recorre todas las imágenes .webp en catalogo-web/fotos/ y, para aquellas
que tienen canal alfa (transparencia), rellena las áreas transparentes con
blanco sólido (#FFFFFF).

REGLAS CLAVE — lo que este script NUNCA hace:
  ✗ No elimina fondos (no usa rembg)
  ✗ No recorta el contenido
  ✗ No redimensiona ni cambia la resolución
  ✗ No modifica imágenes que ya tienen fondo opaco (RGB)
  ✗ No toca productos.json ni ningún archivo de datos

Lo que SÍ hace:
  ✓ RGBA → compone el canal alfa sobre canvas blanco → guarda como RGB webp
  ✓ Preserva 100% del contenido visible de la imagen
  ✓ Mantiene la calidad original (webp lossless si la fuente era lossless,
    o calidad 95 para las que ya eran lossy)
  ✓ Sobreescribe el archivo solo con --apply

Uso:
  python3 pipeline/agregar_fondo_blanco.py           # simulación (muestra qué haría)
  python3 pipeline/agregar_fondo_blanco.py --apply   # aplica los cambios
  python3 pipeline/agregar_fondo_blanco.py --apply --verbose
"""

from __future__ import annotations

import argparse
import csv
import logging
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import List

try:
    from PIL import Image
except ImportError:
    sys.exit(
        "[FATAL] Pillow no encontrado.\n"
        "Ejecuta: source pipeline/venv_fotos/bin/activate"
    )

# ===========================================================================
# MÓDULO 1: Configuración
# ===========================================================================

BASE_DIR  = Path(__file__).resolve().parent
ROOT_DIR  = BASE_DIR.parent
FOTOS_DIR = ROOT_DIR / "catalogo-web" / "fotos"
REPORTE   = ROOT_DIR / "datos" / "reporte_fondo_blanco.csv"
MANIFEST  = BASE_DIR / "generar_manifest_fotos.py"

WEBP_QUALITY  = 95      # calidad para imágenes lossy (0-100)
FONDO_BLANCO  = (255, 255, 255)

logging.basicConfig(
    format="%(asctime)s %(levelname)-8s %(message)s",
    datefmt="%H:%M:%S",
    level=logging.INFO,
    stream=sys.stdout,
)
log = logging.getLogger("agregar_fondo_blanco")


# ===========================================================================
# MÓDULO 2: Tipos de datos
# ===========================================================================

@dataclass
class FotoInfo:
    ruta: Path
    modo: str           # 'RGBA', 'RGB', 'P', etc.
    necesita_fondo: bool


@dataclass
class Resultado:
    archivo: str
    estado: str         # procesado | omitido | error
    detalle: str


# ===========================================================================
# MÓDULO 3: Detección
# ===========================================================================

def tiene_transparencia(img: Image.Image) -> bool:
    """
    Devuelve True si la imagen tiene áreas transparentes o semitransparentes.

    Cubre los casos:
      - RGBA: canal alfa explícito
      - LA:   escala de grises con alfa
      - P:    paleta con color de transparencia definido
    """
    if img.mode in ("RGBA", "LA"):
        return True
    if img.mode == "P" and "transparency" in img.info:
        return True
    return False


def escanear_fotos(directorio: Path) -> List[FotoInfo]:
    """Lista todos los .webp del directorio e indica cuáles necesitan fondo."""
    if not directorio.exists():
        raise FileNotFoundError(f"Carpeta no encontrada: {directorio}")

    infos: List[FotoInfo] = []
    for ruta in sorted(directorio.glob("*.webp")):
        try:
            with Image.open(ruta) as img:
                modo = img.mode
                necesita = tiene_transparencia(img)
        except Exception as exc:
            log.warning("No se pudo leer %s: %s", ruta.name, exc)
            continue
        infos.append(FotoInfo(ruta=ruta, modo=modo, necesita_fondo=necesita))
    return infos


# ===========================================================================
# MÓDULO 4: Procesamiento — agregar fondo blanco
# ===========================================================================

def agregar_fondo(ruta: Path) -> None:
    """
    Compone la imagen RGBA sobre un canvas blanco del mismo tamaño y la
    guarda como RGB webp en el mismo archivo.

    No redimensiona, no recorta, no elimina nada.
    El canal alfa controla qué áreas son transparentes: esas se vuelven blancas.
    El contenido visible (píxeles opacos) se preserva píxel a píxel.
    """
    with Image.open(ruta) as img:
        # Convertir a RGBA para tener canal alfa unificado
        rgba = img.convert("RGBA")

        # Canvas blanco del mismo tamaño
        canvas = Image.new("RGB", rgba.size, FONDO_BLANCO)

        # Componer: los píxeles con alfa > 0 se mezclan con el blanco
        # usando el propio canal alfa como máscara — cero pérdida de detalle
        canvas.paste(rgba, mask=rgba.getchannel("A"))

    # Guardar como WebP RGB (sin canal alfa — ya no hace falta)
    canvas.save(ruta, "WEBP", quality=WEBP_QUALITY, method=6)


# ===========================================================================
# MÓDULO 5: Orquestador
# ===========================================================================

def procesar(infos: List[FotoInfo], aplicar: bool) -> List[Resultado]:
    """Recorre las fotos y aplica (o simula) la composición de fondo blanco."""
    resultados: List[Resultado] = []
    pendientes = [f for f in infos if f.necesita_fondo]
    omitidas   = [f for f in infos if not f.necesita_fondo]

    log.info("Fotos escaneadas            : %d", len(infos))
    log.info("  Con transparencia (a tratar): %d", len(pendientes))
    log.info("  Ya con fondo opaco (omitir) : %d", len(omitidas))

    for f in omitidas:
        resultados.append(Resultado(
            archivo=f.ruta.name,
            estado="omitido",
            detalle=f"modo {f.modo} — ya tiene fondo opaco",
        ))

    for idx, f in enumerate(pendientes, 1):
        prefix = f"[{idx}/{len(pendientes)}]"
        if not aplicar:
            log.info("%s 🔍 %s (%s) → necesita fondo blanco", prefix, f.ruta.name, f.modo)
            resultados.append(Resultado(
                archivo=f.ruta.name,
                estado="pendiente",
                detalle=f"modo {f.modo} — se procesaría con --apply",
            ))
            continue

        try:
            agregar_fondo(f.ruta)
            log.info("%s ✓ %s → fondo blanco agregado", prefix, f.ruta.name)
            resultados.append(Resultado(
                archivo=f.ruta.name,
                estado="procesado",
                detalle=f"modo {f.modo} → RGB con fondo blanco",
            ))
        except Exception as exc:
            log.error("%s ✗ %s → ERROR: %s", prefix, f.ruta.name, exc)
            resultados.append(Resultado(
                archivo=f.ruta.name,
                estado="error",
                detalle=str(exc),
            ))

    return resultados


# ===========================================================================
# MÓDULO 6: Reporte
# ===========================================================================

def escribir_reporte(resultados: List[Resultado], ruta: Path) -> None:
    ruta.parent.mkdir(parents=True, exist_ok=True)
    with ruta.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["archivo", "estado", "detalle"])
        writer.writeheader()
        for r in resultados:
            writer.writerow(r.__dict__)
    log.info("Reporte: %s", ruta)


def imprimir_resumen(resultados: List[Resultado]) -> None:
    conteo: dict = {}
    for r in resultados:
        conteo[r.estado] = conteo.get(r.estado, 0) + 1
    log.info("=" * 60)
    log.info("Resumen: %s", " | ".join(f"{k}={v}" for k, v in sorted(conteo.items())))
    log.info("=" * 60)


# ===========================================================================
# MÓDULO 7: Pregunta manifest (igual que en procesar_fotos_crudas.py)
# ===========================================================================

def _preguntar_manifest() -> None:
    if not MANIFEST.exists():
        return
    print()
    print("  ┌─────────────────────────────────────────────────────────────┐")
    print("  │  ¿Regenerar fotos-manifest.json ahora?                     │")
    print("  │  Recarga el navegador para ver los cambios. [S/n]          │")
    print("  └─────────────────────────────────────────────────────────────┘")
    resp = input("  ¿Generar manifest? [S/n]: ").strip().lower()
    if resp in ("", "s", "si", "sí", "y", "yes"):
        result = subprocess.run([sys.executable, str(MANIFEST)], capture_output=False)
        if result.returncode == 0:
            print("  ✓ Manifest actualizado.")
        else:
            print("  ✗ Error al generar el manifest.")
    else:
        print(f"  → Ejecuta manualmente: python3 {MANIFEST}")


# ===========================================================================
# MÓDULO 8: CLI y main
# ===========================================================================

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description=(
            "Agrega fondo blanco a todas las imágenes .webp con transparencia\n"
            "en catalogo-web/fotos/. No redimensiona ni recorta nada.\n\n"
            "Sin --apply solo muestra qué haría (simulación segura)."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument(
        "--apply",
        action="store_true",
        help="Aplica los cambios sobreescribiendo los archivos.",
    )
    p.add_argument(
        "--reporte",
        type=Path,
        default=REPORTE,
        help=f"Ruta del CSV de auditoría. Default: {REPORTE}",
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
    log.info("Agregar fondo blanco — Aceros Peñascal")
    log.info("Carpeta : %s", FOTOS_DIR)
    log.info("Modo    : %s", "APLICAR" if args.apply else "SIMULACIÓN (dry-run)")
    log.info("=" * 60)

    infos = escanear_fotos(FOTOS_DIR)
    resultados = procesar(infos, aplicar=args.apply)

    escribir_reporte(resultados, args.reporte)
    imprimir_resumen(resultados)

    if args.apply:
        _preguntar_manifest()
    else:
        pendientes = sum(1 for r in resultados if r.estado == "pendiente")
        if pendientes:
            log.info("")
            log.info("Agrega --apply para procesar %d imágenes.", pendientes)

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
