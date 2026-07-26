#!/usr/bin/env python3
import argparse
import csv
import json
import shlex
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
ROOT_DIR = BASE_DIR.parent

RUTA_JSON = ROOT_DIR / "catalogo-web" / "data" / "productos.json"
RUTA_FOTOS = ROOT_DIR / "catalogo-web" / "fotos"
RUTA_REPORTE = ROOT_DIR / "datos" / "fotos_limpiadas.csv"

FOTO_EXTS = ("webp", "jpg", "jpeg", "png")

# La marca que significa directamente: este producto no debe mostrar foto.
ETIQUETAS_DEFAULT = ("sin-foto",)
ETIQUETAS_AUDITORIA = ("sin-foto", "sin-conocimiento")


def cargar_catalogo(ruta):
    if not ruta.exists():
        raise FileNotFoundError(f"No se encontro el archivo: {ruta}")
    with ruta.open("r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict) or not isinstance(data.get("productos"), list):
        raise ValueError("productos.json no tiene la estructura esperada.")
    return data


def etiquetas_de(producto):
    etq = producto.get("etq")
    return set(etq) if isinstance(etq, list) else set()


def coincide(producto, etiquetas_objetivo, modo):
    presentes = etiquetas_de(producto)
    if modo == "all":
        return etiquetas_objetivo.issubset(presentes)
    return bool(etiquetas_objetivo.intersection(presentes))


def es_url(valor):
    return isinstance(valor, str) and valor.lower().startswith(("http://", "https://"))


def ruta_local_foto(valor):
    if not valor or es_url(valor):
        return None

    normalizado = str(valor).strip().replace("\\", "/")
    rel = Path(normalizado)
    if rel.is_absolute():
        return None

    partes = rel.parts
    if len(partes) == 1:
        candidato = RUTA_FOTOS / partes[0]
    elif len(partes) >= 2 and partes[0] == "fotos":
        candidato = RUTA_FOTOS.joinpath(*partes[1:])
    elif len(partes) >= 3 and partes[0] == "catalogo-web" and partes[1] == "fotos":
        candidato = ROOT_DIR.joinpath(*partes)
    else:
        return None

    base = RUTA_FOTOS.resolve()
    resuelto = candidato.resolve()
    try:
        resuelto.relative_to(base)
    except ValueError:
        return None
    return resuelto


def candidatos_foto(producto):
    candidatos = []

    foto = str(producto.get("foto") or "").strip()
    ruta_foto = ruta_local_foto(foto)
    if ruta_foto:
        candidatos.append(ruta_foto)

    producto_id = str(producto.get("id") or "").strip()
    if producto_id:
        for ext in FOTO_EXTS:
            ruta = RUTA_FOTOS / f"{producto_id}.{ext}"
            if ruta.is_file():
                candidatos.append(ruta)

    unicos = []
    vistos = set()
    for ruta in candidatos:
        clave = ruta.resolve()
        if clave in vistos:
            continue
        vistos.add(clave)
        unicos.append(ruta)
    return unicos


def contar_etiquetas(productos):
    sin_foto = sum("sin-foto" in etiquetas_de(p) for p in productos)
    sin_conocimiento = sum("sin-conocimiento" in etiquetas_de(p) for p in productos)
    ambas = sum({"sin-foto", "sin-conocimiento"}.issubset(etiquetas_de(p)) for p in productos)
    union = sum(bool({"sin-foto", "sin-conocimiento"}.intersection(etiquetas_de(p))) for p in productos)
    solo_una = [
        p for p in productos
        if len({"sin-foto", "sin-conocimiento"}.intersection(etiquetas_de(p))) == 1
    ]
    return sin_foto, sin_conocimiento, ambas, union, solo_una


def referencias_no_objetivo(productos, objetivos):
    ids_objetivo = {id(p) for p in objetivos}
    referencias = set()
    for p in productos:
        if id(p) in ids_objetivo:
            continue
        ruta = ruta_local_foto(str(p.get("foto") or "").strip())
        if ruta:
            referencias.add(ruta.resolve())
    return referencias


def construir_plan(data, etiquetas_objetivo, modo):
    productos = data["productos"]
    objetivos = [p for p in productos if coincide(p, etiquetas_objetivo, modo)]
    refs_externas = referencias_no_objetivo(productos, objetivos)

    plan = []
    archivos_a_borrar = []
    archivos_omitidos = []

    for p in objetivos:
        existentes = []
        faltantes = []
        omitidos = []

        for ruta in candidatos_foto(p):
            if ruta.resolve() in refs_externas:
                omitidos.append(ruta)
            elif ruta.is_file():
                existentes.append(ruta)
                archivos_a_borrar.append(ruta)
            else:
                faltantes.append(ruta)

        plan.append({
            "producto": p,
            "id": p.get("id", ""),
            "cod": p.get("cod", ""),
            "nom": p.get("nom", ""),
            "etq": sorted(etiquetas_de(p)),
            "foto_original": str(p.get("foto") or ""),
            "existentes": existentes,
            "faltantes": faltantes,
            "omitidos": omitidos,
        })
        archivos_omitidos.extend(omitidos)

    return plan, sorted(set(archivos_a_borrar)), sorted(set(archivos_omitidos))


def escribir_reporte(plan, ruta_reporte):
    ruta_reporte.parent.mkdir(parents=True, exist_ok=True)
    campos = [
        "id",
        "cod",
        "nom",
        "etq",
        "foto_original",
        "archivos_eliminados",
        "archivos_no_encontrados",
        "archivos_omitidos",
    ]
    with ruta_reporte.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=campos)
        writer.writeheader()
        for item in plan:
            writer.writerow({
                "id": item["id"],
                "cod": item["cod"],
                "nom": item["nom"],
                "etq": ",".join(item["etq"]),
                "foto_original": item["foto_original"],
                "archivos_eliminados": "|".join(r.name for r in item["existentes"]),
                "archivos_no_encontrados": "|".join(r.name for r in item["faltantes"]),
                "archivos_omitidos": "|".join(r.name for r in item["omitidos"]),
            })


def comando_apply(args):
    partes = ["python3", "pipeline/limpiar_fotos.py", "--apply"]
    if tuple(args.tags) != ETIQUETAS_DEFAULT:
        for tag in args.tags:
            partes.extend(["--tag", tag])
    if args.match != "any":
        partes.extend(["--match", args.match])
    return " ".join(shlex.quote(p) for p in partes)


def imprimir_resumen(data, plan, archivos_a_borrar, archivos_omitidos, solo_una, args):
    print("=" * 72)
    print("Limpieza de fotos marcadas desde el clasificador")
    print("=" * 72)
    print(f"Modo: {'APLICAR CAMBIOS' if args.apply else 'SIMULACION'}")
    print(f"Etiquetas objetivo: {', '.join(args.tags)}")
    print(f"Coincidencia: {args.match}")
    print(f"Productos objetivo: {len(plan)}")
    print(f"Productos con foto en datos: {sum(bool(i['foto_original']) for i in plan)}")
    print(f"Archivos existentes a borrar: {len(archivos_a_borrar)}")
    print(f"Archivos omitidos por estar referenciados por otros productos: {len(archivos_omitidos)}")
    print("Archivos de datos: no se modifican productos.json ni productos.js")

    sin_foto, sin_conocimiento, ambas, union, _ = contar_etiquetas(data["productos"])
    print("-" * 72)
    print(f"Auditoria de marcas: sin-foto={sin_foto}, sin-conocimiento={sin_conocimiento}, ambas={ambas}, union={union}")
    if solo_una:
        print("Productos con una sola de las dos marcas de auditoria:")
        for p in solo_una:
            print(f"  - {p.get('id')} | {p.get('cod')} | {sorted(etiquetas_de(p))}")

    if not args.apply:
        print("-" * 72)
        print(f"No se modifico nada. Para ejecutar: {comando_apply(args)}")
    else:
        print(f"Reporte: {RUTA_REPORTE}")
    print("=" * 72)


def aplicar_plan(plan, archivos_a_borrar):
    eliminadas = 0
    for ruta in archivos_a_borrar:
        if ruta.is_file():
            ruta.unlink()
            eliminadas += 1

    escribir_reporte(plan, RUTA_REPORTE)
    return eliminadas


def parse_args():
    parser = argparse.ArgumentParser(
        description="Borra solo archivos fisicos de fotos para productos marcados en el clasificador."
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Aplica cambios. Sin esta bandera solo muestra una simulacion.",
    )
    parser.add_argument(
        "--tag",
        dest="tags",
        action="append",
        help="Etiqueta objetivo. Se puede repetir. Default: sin-foto.",
    )
    parser.add_argument(
        "--match",
        choices=("any", "all"),
        default="any",
        help="Usa 'any' si basta una etiqueta, o 'all' si deben estar todas.",
    )
    args = parser.parse_args()
    args.tags = args.tags or list(ETIQUETAS_DEFAULT)
    return args


def main():
    args = parse_args()
    etiquetas_objetivo = set(args.tags)

    data = cargar_catalogo(RUTA_JSON)
    plan, archivos_a_borrar, archivos_omitidos = construir_plan(data, etiquetas_objetivo, args.match)
    *_, solo_una = contar_etiquetas(data["productos"])

    imprimir_resumen(data, plan, archivos_a_borrar, archivos_omitidos, solo_una, args)

    if not args.apply:
        return 0

    eliminadas = aplicar_plan(plan, archivos_a_borrar)
    print(f"Fotos eliminadas: {eliminadas}")
    print("productos.json y productos.js quedaron sin cambios.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        raise SystemExit(1)
