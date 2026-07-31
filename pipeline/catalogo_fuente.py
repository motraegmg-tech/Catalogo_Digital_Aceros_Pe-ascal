#!/usr/bin/env python3
"""
catalogo_fuente.py — De dónde leen el catálogo los scripts de fotos.

Antes cada script abría `catalogo-web/data/productos.json` directamente. Ese
archivo es un RESPALDO que se regenera desde Supabase, así que podía estar
viejo: se procesaban fotos de una lista que ya no era la vigente, o se pasaban
por alto productos marcados desde el clasificador minutos antes.

Este módulo lee de Supabase (la fuente de verdad) y solo cae al archivo local
si no hay red. Usa la vista pública `catalogo_publico` con la anon key —la
misma que ya está publicada en el sitio—, así que es de SOLO LECTURA y no
necesita credenciales ni instalar nada.

Uso:
    from catalogo_fuente import cargar_productos, filtrar_por_etiqueta

    productos = cargar_productos()                       # todos
    sin_foto  = filtrar_por_etiqueta(productos, "sin-foto")
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import List, Optional

ROOT_DIR = Path(__file__).resolve().parent.parent
PRODUCTOS_JSON = ROOT_DIR / "catalogo-web" / "data" / "productos.json"

SUPA_URL = "https://qdlezhfcnwsygtosieme.supabase.co"
SUPA_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFkbGV6"
    "aGZjbndzeWd0b3NpZW1lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQyMzU2NjEsImV4cCI6MjA5"
    "OTgxMTY2MX0.8SwUSs76lJNsQXp8qR_gTHbPRHcdfg6C5Et4Wg6wTp8"
)

PAGE_SIZE = 1000
TIMEOUT = 20

# La vista entrega nombres de columna de la base; los scripts esperan las
# claves cortas del archivo local. Se traduce aquí para que ambos caminos
# devuelvan exactamente la misma forma.
_CAMPOS = "codigo,descripcion,categoria,subcategoria,sub2,medidas,foto,etiquetas"


def _desde_supabase() -> List[dict]:
    productos: List[dict] = []
    offset = 0
    while True:
        url = (
            f"{SUPA_URL}/rest/v1/catalogo_publico"
            f"?select={_CAMPOS}&order=codigo&limit={PAGE_SIZE}&offset={offset}"
        )
        req = urllib.request.Request(
            url,
            headers={"apikey": SUPA_KEY, "Authorization": f"Bearer {SUPA_KEY}"},
        )
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            lote = json.loads(resp.read().decode("utf-8"))
        for r in lote:
            productos.append(
                {
                    "cod": r.get("codigo") or "",
                    "nom": r.get("descripcion") or "",
                    "cat": r.get("categoria") or "",
                    "sub": r.get("subcategoria") or "",
                    "sub2": r.get("sub2") or "",
                    "med": r.get("medidas") or "",
                    "foto": r.get("foto") or "",
                    "etq": list(r.get("etiquetas") or []),
                }
            )
        if len(lote) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
    return productos


def _desde_archivo() -> List[dict]:
    with PRODUCTOS_JSON.open("r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data.get("productos"), list):
        raise ValueError("productos.json no tiene la estructura esperada.")
    return [p for p in data["productos"] if isinstance(p, dict)]


def cargar_productos(preferir_local: bool = False) -> List[dict]:
    """
    Devuelve la lista de productos. Intenta Supabase primero; si falla la red
    (o si se pide explícitamente), usa el archivo local y lo avisa por stderr,
    para que nadie procese datos viejos sin enterarse.
    """
    if not preferir_local:
        try:
            productos = _desde_supabase()
            if productos:
                print(f"[catalogo] {len(productos)} productos desde Supabase.", file=sys.stderr)
                return productos
            print("[catalogo] Supabase respondió vacío; uso el archivo local.", file=sys.stderr)
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError) as e:
            print(f"[catalogo] Sin conexión a Supabase ({e}); uso el archivo local.", file=sys.stderr)

    productos = _desde_archivo()
    print(
        f"[catalogo] {len(productos)} productos desde {PRODUCTOS_JSON.name} "
        "(respaldo local: puede estar desactualizado).",
        file=sys.stderr,
    )
    return productos


def filtrar_por_etiqueta(productos: List[dict], etiqueta: str) -> List[dict]:
    return [p for p in productos if etiqueta in (p.get("etq") or [])]


def con_foto(productos: List[dict]) -> List[dict]:
    return [p for p in productos if p.get("foto")]


if __name__ == "__main__":
    ps = cargar_productos()
    print(f"Total: {len(ps)}")
    print(f"  sin-foto:        {len(filtrar_por_etiqueta(ps, 'sin-foto'))}")
    print(f"  sin-conocimiento:{len(filtrar_por_etiqueta(ps, 'sin-conocimiento'))}")
    print(f"  con foto:        {len(con_foto(ps))}")
