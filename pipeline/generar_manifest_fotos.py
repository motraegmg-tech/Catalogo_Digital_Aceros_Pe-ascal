#!/usr/bin/env python3
"""
generar_manifest_fotos.py — Genera catalogo-web/data/fotos-manifest.json

Lista todos los archivos (stems, sin extensión) que existen físicamente en
catalogo-web/fotos/ y los escribe en un JSON que la app web consume para
saber, sin hacer peticiones al servidor, qué productos tienen foto real.

Ejecutar cada vez que se agreguen o eliminen fotos del catálogo.
"""

import json
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
ROOT_DIR = BASE_DIR.parent

FOTOS_DIR = ROOT_DIR / "catalogo-web" / "fotos"
OUTPUT    = ROOT_DIR / "catalogo-web" / "data" / "fotos-manifest.json"

EXTS_IMAGEN = {".webp", ".jpg", ".jpeg", ".png", ".avif"}


def main() -> int:
    if not FOTOS_DIR.exists():
        print(f"[ERROR] Carpeta no encontrada: {FOTOS_DIR}", file=sys.stderr)
        return 1

    stems = sorted(
        f.stem
        for f in FOTOS_DIR.iterdir()
        if f.is_file() and f.suffix.lower() in EXTS_IMAGEN
    )

    OUTPUT.write_text(json.dumps(stems, ensure_ascii=False), encoding="utf-8")
    print(f"✓ Manifest generado: {len(stems)} fotos → {OUTPUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
