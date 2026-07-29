#!/usr/bin/env python3
import argparse
import csv
import json
import random
import re
import sys
import time
import unicodedata
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence
from urllib.parse import urlparse

import requests
from ddgs import DDGS
from PIL import Image, ImageChops, ImageFilter, ImageStat
from rembg import new_session, remove

BASE_DIR = Path(__file__).resolve().parent
ROOT_DIR = BASE_DIR.parent

PRODUCTOS_JSON_PATH = ROOT_DIR / "catalogo-web" / "data" / "productos.json"
PLANTILLA_FOTOS_CSV_PATH = ROOT_DIR / "datos" / "plantilla_fotos.csv"
PROVEEDORES_DOMINIOS_PATH = ROOT_DIR / "datos" / "proveedores_dominios.json"
REPORTE_PATH = ROOT_DIR / "datos" / "auto_fotos_reporte.csv"
FOTOS_DIR = ROOT_DIR / "catalogo-web" / "fotos"

CANVAS_SIZE = (800, 800)
PRODUCT_MAX_SIZE = (740, 740)
MIN_IMAGE_BYTES = 4096
MIN_IMAGE_EDGE = 180
ALPHA_THRESHOLD = 10
CROP_MARGIN = 18
WATERMARK_ALPHA = 70
DEFAULT_DELAY_RANGE = (1.2, 2.4)

RESAMPLE = getattr(Image, "Resampling", Image).LANCZOS

SESSION = requests.Session()
SESSION.headers.update(
    {
        "User-Agent": (
            "Mozilla/5.0 (X11; Linux x86_64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/126.0.0.0 Safari/537.36"
        ),
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    }
)


@dataclass(frozen=True)
class FotoPendiente:
    producto: Dict[str, Any]
    codigo: str
    nombre: str
    proveedor: str
    archivo: str
    destino: Path


@dataclass(frozen=True)
class Resultado:
    codigo: str
    proveedor: str
    archivo: str
    estado: str
    detalle: str
    url: str = ""


def normalizar_texto(valor: Any) -> str:
    texto = "" if valor is None else str(valor)
    texto = unicodedata.normalize("NFKD", texto)
    texto = "".join(ch for ch in texto if not unicodedata.combining(ch))
    return re.sub(r"\s+", " ", texto).strip().lower()


def limpiar_token(valor: Any) -> str:
    texto = normalizar_texto(valor)
    texto = re.sub(r"[\s_]+", "-", texto)
    return re.sub(r"[^a-z0-9.-]+", "", texto)


def first_non_empty(data: Dict[str, Any], keys: Iterable[str]) -> str:
    for key in keys:
        value = data.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def cargar_catalogo(path: Path) -> List[Dict[str, Any]]:
    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict) or not isinstance(data.get("productos"), list):
        raise ValueError("productos.json no tiene la estructura esperada.")
    return [p for p in data["productos"] if isinstance(p, dict)]


def etiquetas_de(producto: Dict[str, Any]) -> set:
    etq = producto.get("etq")
    return set(etq) if isinstance(etq, list) else set()


def es_sin_foto(producto: Dict[str, Any]) -> bool:
    return "sin-foto" in etiquetas_de(producto)


def cargar_plantilla(path: Path) -> Dict[str, str]:
    mapa: Dict[str, str] = {}
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        for fila in csv.DictReader(f):
            codigo = first_non_empty(fila, ("codigo", "cod", "sku", "id", "clave"))
            archivo = first_non_empty(fila, ("archivo_foto", "foto", "imagen", "image", "file"))
            if codigo and archivo:
                mapa[normalizar_texto(codigo)] = archivo
    return mapa


def cargar_dominios_proveedores(path: Path) -> Dict[str, List[str]]:
    if not path.exists():
        return {}

    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)

    if not isinstance(data, dict):
        raise ValueError("proveedores_dominios.json debe ser un objeto proveedor -> dominios.")

    dominios: Dict[str, List[str]] = {}
    for proveedor, valores in data.items():
        if isinstance(valores, str):
            valores = [valores]
        if not isinstance(valores, list):
            continue

        limpios = [normalizar_dominio(v) for v in valores if normalizar_dominio(v)]
        if limpios:
            dominios[normalizar_texto(proveedor)] = sorted(set(limpios))
    return dominios


def obtener_codigo(producto: Dict[str, Any]) -> str:
    return first_non_empty(producto, ("cod", "codigo", "código", "sku", "id", "clave"))


def obtener_nombre(producto: Dict[str, Any]) -> str:
    return first_non_empty(producto, ("nom", "nombre", "descripcion", "descripción", "producto", "titulo"))


def obtener_archivo(producto: Dict[str, Any], plantilla: Dict[str, str]) -> Optional[str]:
    codigo = obtener_codigo(producto)
    archivo = plantilla.get(normalizar_texto(codigo))
    if archivo:
        return archivo

    foto = first_non_empty(producto, ("foto",))
    if foto and not es_url(foto):
        return Path(foto.replace("\\", "/")).name

    return f"{producto.get('id') or codigo}.webp" if (producto.get("id") or codigo) else None


def construir_pendientes(productos: Sequence[Dict[str, Any]], plantilla: Dict[str, str]) -> List[FotoPendiente]:
    pendientes: List[FotoPendiente] = []
    for producto in productos:
        if not es_sin_foto(producto):
            continue

        archivo = obtener_archivo(producto, plantilla)
        if not archivo:
            continue

        destino = ruta_destino_segura(archivo)
        pendientes.append(
            FotoPendiente(
                producto=producto,
                codigo=obtener_codigo(producto),
                nombre=obtener_nombre(producto),
                proveedor=first_non_empty(producto, ("prov", "proveedor")),
                archivo=destino.name,
                destino=destino,
            )
        )
    return pendientes


def ruta_destino_segura(archivo: str) -> Path:
    nombre = Path(str(archivo).replace("\\", "/")).name
    if not nombre:
        raise ValueError("Nombre de archivo de foto vacio.")
    destino = (FOTOS_DIR / nombre).resolve()
    destino.relative_to(FOTOS_DIR.resolve())
    return destino


def es_url(valor: str) -> bool:
    return valor.lower().startswith(("http://", "https://"))


def normalizar_dominio(valor: Any) -> str:
    texto = "" if valor is None else str(valor).strip()
    if not texto:
        return ""
    if not re.match(r"^https?://", texto, flags=re.I):
        texto = "https://" + texto
    host = urlparse(texto).netloc.lower().split(":")[0]
    return host[4:] if host.startswith("www.") else host


def host_de_url(url: str) -> str:
    host = urlparse(url).netloc.lower().split(":")[0]
    return host[4:] if host.startswith("www.") else host


def url_permitida(url: str, dominios: Sequence[str]) -> bool:
    if not url or not es_url(url):
        return False
    host = host_de_url(url)
    return any(host == dominio or host.endswith("." + dominio) for dominio in dominios)


def consulta_producto(item: FotoPendiente) -> str:
    partes = [
        item.codigo,
        item.nombre,
        first_non_empty(item.producto, ("sub", "sub2", "cat")),
    ]
    texto = " ".join(p for p in partes if p)
    texto = re.sub(r"\b(POR CLASIFICAR|sin foto|sinfoto)\b", " ", texto, flags=re.I)
    texto = re.sub(r"\s+", " ", texto).strip()
    return texto


def resultado_image_url(resultado: Dict[str, Any]) -> str:
    return first_non_empty(resultado, ("image", "thumbnail", "url"))


def resultado_source_url(resultado: Dict[str, Any]) -> str:
    return first_non_empty(resultado, ("source", "page_url", "href", "origin"))


def buscar_imagen_oficial(ddgs: DDGS, item: FotoPendiente, dominios: Sequence[str], max_results: int) -> Optional[str]:
    base_query = consulta_producto(item)
    if not base_query:
        return None

    for dominio in dominios:
        query = f'{base_query} site:{dominio}'
        resultados = list(ddgs.images(query, max_results=max_results))
        for resultado in resultados:
            imagen = resultado_image_url(resultado)
            fuente = resultado_source_url(resultado)
            if imagen and url_permitida(imagen, dominios):
                return imagen
            if imagen and fuente and url_permitida(fuente, dominios):
                return imagen
    return None


def descargar_imagen(url: str, dominios: Sequence[str]) -> bytes:
    if not url_permitida(url, dominios):
        raise ValueError("URL fuera de dominios oficiales permitidos.")

    respuesta = SESSION.get(url, timeout=20)
    respuesta.raise_for_status()

    contenido = respuesta.content
    content_type = respuesta.headers.get("content-type", "").lower()
    firma_valida = contenido.startswith((b"\xff\xd8", b"\x89PNG", b"RIFF", b"GIF8"))
    if "image" not in content_type and not firma_valida:
        raise ValueError("La respuesta no parece ser una imagen.")
    if len(contenido) < MIN_IMAGE_BYTES:
        raise ValueError("Imagen demasiado pequena para catalogo.")
    return contenido


def abrir_imagen(datos: bytes) -> Image.Image:
    imagen = Image.open(BytesIO(datos))
    imagen.load()
    if imagen.width < MIN_IMAGE_EDGE or imagen.height < MIN_IMAGE_EDGE:
        raise ValueError("Imagen con resolucion insuficiente.")
    return imagen.convert("RGBA")


def neutralizar_marca_agua_suave(imagen: Image.Image) -> Image.Image:
    if imagen.mode != "RGBA":
        imagen = imagen.convert("RGBA")

    alpha = imagen.getchannel("A")
    centro = alpha.crop((imagen.width // 5, imagen.height // 5, imagen.width * 4 // 5, imagen.height * 4 // 5))
    if ImageStat.Stat(centro).mean[0] < 245:
        return imagen

    rgb = imagen.convert("RGB")
    gris = rgb.convert("L")
    bordes = gris.filter(ImageFilter.FIND_EDGES)
    marca = bordes.point(lambda p: 255 if 12 <= p <= 42 else 0).filter(ImageFilter.GaussianBlur(1.2))
    marca = ImageChops.multiply(marca, alpha.point(lambda p: 255 if p > 245 else 0))
    overlay = Image.new("RGBA", imagen.size, (255, 255, 255, WATERMARK_ALPHA))
    return Image.composite(overlay, imagen, marca).convert("RGBA")


def remover_fondo_seguro(datos: bytes, sesion_ia: Any) -> Image.Image:
    original = abrir_imagen(datos)
    sin_fondo = Image.open(BytesIO(remove(datos, session=sesion_ia))).convert("RGBA")
    if not sin_fondo.getchannel("A").getbbox():
        return original
    return sin_fondo


def recortar_transparencia(imagen: Image.Image) -> Image.Image:
    alpha = imagen.getchannel("A")
    mascara = alpha.point(lambda p: 255 if p > ALPHA_THRESHOLD else 0)
    bbox = mascara.getbbox()
    if not bbox:
        return imagen

    left = max(0, bbox[0] - CROP_MARGIN)
    top = max(0, bbox[1] - CROP_MARGIN)
    right = min(imagen.width, bbox[2] + CROP_MARGIN)
    bottom = min(imagen.height, bbox[3] + CROP_MARGIN)
    return imagen.crop((left, top, right, bottom))


def estandarizar_imagen(datos: bytes, sesion_ia: Any) -> Image.Image:
    imagen = remover_fondo_seguro(datos, sesion_ia)
    imagen = neutralizar_marca_agua_suave(imagen)
    imagen = recortar_transparencia(imagen)
    imagen.thumbnail(PRODUCT_MAX_SIZE, RESAMPLE)

    canvas = Image.new("RGBA", CANVAS_SIZE, (255, 255, 255, 255))
    x = (CANVAS_SIZE[0] - imagen.width) // 2
    y = (CANVAS_SIZE[1] - imagen.height) // 2
    canvas.alpha_composite(imagen, (x, y))
    return canvas.convert("RGB")


def guardar_imagen(imagen: Image.Image, destino: Path) -> None:
    destino.parent.mkdir(parents=True, exist_ok=True)
    ext = destino.suffix.lower()
    if ext in (".jpg", ".jpeg"):
        imagen.save(destino, "JPEG", quality=92, optimize=True, progressive=True)
    elif ext == ".png":
        imagen.save(destino, "PNG", optimize=True)
    else:
        imagen.save(destino.with_suffix(".webp"), "WEBP", quality=86, method=6)


def escribir_reporte(resultados: Sequence[Resultado], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["codigo", "proveedor", "archivo", "estado", "detalle", "url"])
        writer.writeheader()
        for r in resultados:
            writer.writerow(r.__dict__)


def procesar_item(ddgs: DDGS, item: FotoPendiente, dominios: Sequence[str], args: argparse.Namespace, sesion_ia: Any) -> Resultado:
    if item.destino.exists() and item.destino.stat().st_size > 0 and not args.overwrite:
        return Resultado(item.codigo, item.proveedor, item.archivo, "skip", "archivo existente")

    if not dominios:
        return Resultado(item.codigo, item.proveedor, item.archivo, "skip", "proveedor sin dominios oficiales configurados")

    if not args.apply:
        return Resultado(item.codigo, item.proveedor, item.archivo, "dry-run", "pendiente con proveedor permitido")

    url = buscar_imagen_oficial(ddgs, item, dominios, args.max_results)
    if not url:
        return Resultado(item.codigo, item.proveedor, item.archivo, "skip", "sin coincidencia en fuente oficial")

    datos = descargar_imagen(url, dominios)
    imagen = estandarizar_imagen(datos, sesion_ia)
    guardar_imagen(imagen, item.destino)
    return Resultado(item.codigo, item.proveedor, item.archivo, "ok", "imagen guardada", url)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Busca y estandariza fotos solo para productos marcados como sin-foto."
    )
    parser.add_argument("--apply", action="store_true", help="Descarga y guarda imagenes. Sin esto solo simula.")
    parser.add_argument("--limit", type=int, default=0, help="Limita la cantidad de productos a procesar.")
    parser.add_argument("--overwrite", action="store_true", help="Reemplaza fotos existentes.")
    parser.add_argument("--max-results", type=int, default=8, help="Resultados por dominio oficial.")
    parser.add_argument("--domains", type=Path, default=PROVEEDORES_DOMINIOS_PATH, help="JSON proveedor -> dominios.")
    parser.add_argument("--report", type=Path, default=REPORTE_PATH, help="CSV de auditoria del proceso.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    productos = cargar_catalogo(PRODUCTOS_JSON_PATH)
    plantilla = cargar_plantilla(PLANTILLA_FOTOS_CSV_PATH)
    dominios_por_proveedor = cargar_dominios_proveedores(args.domains)
    pendientes = construir_pendientes(productos, plantilla)
    if args.limit > 0:
        pendientes = pendientes[: args.limit]

    print(f"[INFO] productos.json: {PRODUCTOS_JSON_PATH}")
    print("[INFO] productos.json se abre solo en lectura; no se modifica.")
    print(f"[INFO] Productos sin-foto detectados: {len(pendientes)}")
    print(f"[INFO] Dominios oficiales configurados: {len(dominios_por_proveedor)} proveedores")
    print(f"[INFO] Modo: {'APLICAR' if args.apply else 'SIMULACION'}")

    resultados: List[Resultado] = []
    sesion_ia = None
    if args.apply:
        print("[INFO] Cargando modelo local de recorte de fondo...")
        sesion_ia = new_session("u2net")

    with DDGS() as ddgs:
        for index, item in enumerate(pendientes, 1):
            dominios = dominios_por_proveedor.get(normalizar_texto(item.proveedor), [])
            try:
                resultado = procesar_item(ddgs, item, dominios, args, sesion_ia)
            except Exception as exc:
                resultado = Resultado(item.codigo, item.proveedor, item.archivo, "error", str(exc))
            resultados.append(resultado)
            print(f"[{index}/{len(pendientes)}] {resultado.estado.upper()} {item.codigo} - {resultado.detalle}")
            if args.apply and resultado.estado in {"ok", "error"}:
                time.sleep(random.uniform(*DEFAULT_DELAY_RANGE))

    escribir_reporte(resultados, args.report)
    conteo: Dict[str, int] = {}
    for resultado in resultados:
        conteo[resultado.estado] = conteo.get(resultado.estado, 0) + 1

    print(f"[INFO] Reporte: {args.report}")
    print("[INFO] Resumen: " + ", ".join(f"{k}={v}" for k, v in sorted(conteo.items())))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        raise SystemExit(1)
