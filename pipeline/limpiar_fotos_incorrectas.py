#!/usr/bin/env python3
"""
limpiar_fotos_incorrectas.py — Elimina fotos erróneas de productos sin-foto.

Lee productos.json (SOLO LECTURA) y busca todos los que tengan la etiqueta
"sin-foto". Si alguno de esos productos tiene un archivo de imagen en
catalogo-web/fotos/, ese archivo es incorrecto (genera ruido visual en el
catálogo) y debe eliminarse.

Principio de responsabilidad única (Clean Code):
  - MÓDULO 1: Configuración y constantes
  - MÓDULO 2: Carga de datos      (productos.json — SOLO LECTURA)
  - MÓDULO 3: Resolver archivos   (qué archivo le corresponde a cada producto)
  - MÓDULO 4: Auditoría           (cuáles están en disco y cuáles no)
  - MÓDULO 5: Eliminador          (borra solo con --apply)
  - MÓDULO 6: Reporter            (CSV de auditoría)
  - MÓDULO 7: CLI y main

Uso:
  python3 pipeline/limpiar_fotos_incorrectas.py            # simulación segura
  python3 pipeline/limpiar_fotos_incorrectas.py --apply    # elimina los archivos
  python3 pipeline/limpiar_fotos_incorrectas.py --apply --verbose
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional

from catalogo_fuente import cargar_productos, filtrar_por_etiqueta

# ===========================================================================
# MÓDULO 1: Configuración y constantes
# ===========================================================================

BASE_DIR       = Path(__file__).resolve().parent
ROOT_DIR       = BASE_DIR.parent

PRODUCTOS_JSON = ROOT_DIR / "catalogo-web" / "data" / "productos.json"
FOTOS_DIR      = ROOT_DIR / "catalogo-web" / "fotos"
REPORTE_CSV    = ROOT_DIR / "datos" / "reporte_limpiar_fotos.csv"

logging.basicConfig(
    format="%(asctime)s %(levelname)-8s %(message)s",
    datefmt="%H:%M:%S",
    level=logging.INFO,
    stream=sys.stdout,
)
log = logging.getLogger("limpiar_fotos_incorrectas")


# ===========================================================================
# MÓDULO 2: Tipos de datos
# ===========================================================================

@dataclass
class FotoIncorrecta:
    """Foto errónea detectada: producto sin-foto pero con archivo en disco."""
    cod: str
    nom: str
    archivo: str          # nombre del archivo (p.ej. ANGD.webp)
    ruta: Path            # ruta completa en catalogo-web/fotos/


@dataclass
class Resultado:
    cod: str
    nom: str
    archivo: str
    estado: str           # eliminado | no-existe | error
    detalle: str


# ===========================================================================
# MÓDULO 3: Carga de datos (productos.json → SOLO LECTURA)
# ===========================================================================

def cargar_productos_sin_foto() -> List[dict]:
    """
    Devuelve solo los productos marcados 'sin-foto'. NUNCA escribe nada.

    Lee de Supabase (fuente de verdad) y cae al archivo local solo si no hay
    red. Antes leía productos.json directo, que es un respaldo y podía estar
    viejo: se procesaban productos que ya no estaban marcados, o se pasaban por
    alto los marcados desde el clasificador hace un momento.
    """
    return filtrar_por_etiqueta(cargar_productos(), "sin-foto")


# ===========================================================================
# MÓDULO 4: Resolver archivos (qué archivo en disco corresponde a cada producto)
# ===========================================================================

def _resolver_nombre_archivo(producto: dict) -> Optional[str]:
    """
    Determina el nombre de archivo de la foto de un producto.
    El campo 'foto' en el JSON es la fuente de verdad directa.
    Retorna None si el producto no tiene campo foto definido.
    """
    foto = producto.get("foto", "")
    return foto.strip() if isinstance(foto, str) and foto.strip() else None


def _ruta_segura(nombre_archivo: str) -> Optional[Path]:
    """
    Construye la ruta absoluta y valida que esté dentro de FOTOS_DIR
    para prevenir path traversal accidental.
    """
    ruta = (FOTOS_DIR / nombre_archivo).resolve()
    try:
        ruta.relative_to(FOTOS_DIR.resolve())
        return ruta
    except ValueError:
        return None


# ===========================================================================
# MÓDULO 5: Auditoría (cuáles fotos erróneas existen en disco)
# ===========================================================================

def detectar_fotos_incorrectas(productos: List[dict]) -> List[FotoIncorrecta]:
    """
    Recorre los productos sin-foto y devuelve los que tienen un archivo
    de foto existente en catalogo-web/fotos/.
    """
    incorrectas: List[FotoIncorrecta] = []

    for p in productos:
        cod = p.get("cod", "").strip()
        nom = p.get("nom", "").strip()
        nombre_archivo = _resolver_nombre_archivo(p)

        if not nombre_archivo:
            continue   # sin campo foto → no hay archivo que borrar

        ruta = _ruta_segura(nombre_archivo)
        if not ruta:
            log.warning("Ruta insegura ignorada: %s → %s", cod, nombre_archivo)
            continue

        if ruta.exists():
            incorrectas.append(FotoIncorrecta(
                cod=cod,
                nom=nom,
                archivo=nombre_archivo,
                ruta=ruta,
            ))

    return incorrectas


# ===========================================================================
# MÓDULO 6: Eliminador
# ===========================================================================

def eliminar_foto(foto: FotoIncorrecta) -> Resultado:
    """
    Elimina el archivo de foto incorrecto. Solo debe llamarse con --apply.
    """
    try:
        foto.ruta.unlink()
        return Resultado(
            cod=foto.cod,
            nom=foto.nom,
            archivo=foto.archivo,
            estado="eliminado",
            detalle=f"Archivo eliminado: {foto.ruta}",
        )
    except Exception as exc:
        return Resultado(
            cod=foto.cod,
            nom=foto.nom,
            archivo=foto.archivo,
            estado="error",
            detalle=str(exc),
        )


# ===========================================================================
# MÓDULO 7: Reporter
# ===========================================================================

def escribir_reporte(resultados: List[Resultado], path: Path) -> None:
    """Escribe CSV de auditoría con todos los archivos procesados."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=["cod", "nom", "archivo", "estado", "detalle"],
        )
        writer.writeheader()
        for r in resultados:
            writer.writerow(r.__dict__)
    log.info("Reporte guardado en: %s", path)


def imprimir_resumen(resultados: List[Resultado]) -> None:
    conteo: Dict[str, int] = {}
    for r in resultados:
        conteo[r.estado] = conteo.get(r.estado, 0) + 1
    linea = " | ".join(f"{k}={v}" for k, v in sorted(conteo.items()))
    log.info("=" * 60)
    log.info("Resumen: %s", linea)
    log.info("=" * 60)


# ===========================================================================
# MÓDULO 8: CLI y main
# ===========================================================================

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description=(
            "Elimina fotos erróneas de productos marcados 'sin-foto'.\n\n"
            "Lee productos.json (SOLO LECTURA), detecta qué productos sin-foto\n"
            "tienen un archivo en catalogo-web/fotos/ y los elimina.\n\n"
            "Sin --apply solo muestra qué borraría (simulación segura)."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument(
        "--apply",
        action="store_true",
        help="Ejecuta la eliminación real. Sin esta bandera es solo simulación.",
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
    log.info("Limpieza de fotos incorrectas — Aceros Peñascal")
    log.info("JSON   : %s (SOLO LECTURA)", PRODUCTOS_JSON)
    log.info("Fotos  : %s", FOTOS_DIR)
    log.info("Modo   : %s", "ELIMINAR" if args.apply else "SIMULACIÓN (dry-run)")
    log.info("=" * 60)

    # ── Carga ────────────────────────────────────────────────────────────────
    productos = cargar_productos_sin_foto()
    log.info("Productos con etiqueta 'sin-foto': %d", len(productos))

    # ── Detección ─────────────────────────────────────────────────────────────
    incorrectas = detectar_fotos_incorrectas(productos)
    sin_archivo  = len(productos) - len([p for p in productos if _resolver_nombre_archivo(p)]) \
                   + len([p for p in productos if _resolver_nombre_archivo(p) and
                          not (_ruta_segura(_resolver_nombre_archivo(p)) or Path("/x")).exists()])

    log.info("Con foto errónea en disco     : %d", len(incorrectas))
    log.info("Sin archivo en disco (ok)     : %d", len(productos) - len(incorrectas))

    # ── Modo simulación ───────────────────────────────────────────────────────
    if not args.apply:
        log.info("")
        log.info("──── ARCHIVOS A ELIMINAR (simulación) ────")
        for f in incorrectas:
            log.info("  🗑  %-20s  %s", f.cod, f.archivo)
        log.info("")
        log.info("Total a eliminar: %d archivos", len(incorrectas))
        log.info("Agrega --apply para ejecutar la eliminación.")
        return 0

    # ── Eliminación real ──────────────────────────────────────────────────────
    resultados: List[Resultado] = []

    for idx, foto in enumerate(incorrectas, 1):
        resultado = eliminar_foto(foto)
        resultados.append(resultado)

        if resultado.estado == "eliminado":
            log.info("[%d/%d] 🗑  %s → %s",
                     idx, len(incorrectas), foto.cod, foto.archivo)
        else:
            log.error("[%d/%d] ✗  %s → %s : %s",
                      idx, len(incorrectas), foto.cod, foto.archivo, resultado.detalle)

    # ── Reporte ───────────────────────────────────────────────────────────────
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
