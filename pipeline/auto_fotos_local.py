import csv
import os
import time
import random
import requests
from io import BytesIO
from PIL import Image
from rembg import remove, new_session
# Importamos directamente la clase actualizada
from ddgs import DDGS

# 1. CORRECCIÓN DE RUTAS: Usamos rutas absolutas relativas a este archivo
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CSV_PATH = os.path.join(BASE_DIR, '../datos/plantilla_fotos.csv')
FOTOS_DIR = os.path.join(BASE_DIR, '../catalogo-web/fotos/')

# 2. ORQUESTADOR DEL PIPELINE
def procesar_catalogo():
    # Nos aseguramos de crear la carpeta en la ruta absoluta correcta
    os.makedirs(FOTOS_DIR, exist_ok=True)
    
    productos = leer_csv(CSV_PATH)
    
    print(f"[ARQUITECTURA] Cargando modelo IA (U2Net) en: {BASE_DIR}")
    sesion_ia = new_session('u2net')
    
    # Usamos la clase DDGS actualizada
    with DDGS() as ddgs:
        for prod in productos:
            archivo_destino = prod.get('archivo_foto', '').strip()
            if not archivo_destino:
                continue
                
            ruta_final = os.path.join(FOTOS_DIR, archivo_destino)
            
            # Idempotencia
            if os.path.exists(ruta_final):
                continue

            query = f"{prod.get('descripcion', '')} {prod.get('categoria', '')} aceros"
            print(f"[PROCESANDO] {query}")
            
            try:
                url_img = buscar_imagen_gratis(ddgs, query)
                if not url_img:
                    continue
                
                img_bytes = descargar_imagen(url_img)
                img_sin_fondo = remover_fondo_ai(img_bytes, sesion_ia)
                formatear_y_guardar(img_sin_fondo, ruta_final)
                
                print(f"[ÉXITO] Guardado en: {ruta_final}")
                time.sleep(random.uniform(1.0, 2.0))
                
            except Exception as e:
                print(f"[ERROR] {archivo_destino}: {str(e)}")

def leer_csv(ruta):
    productos = []
    with open(ruta, mode='r', encoding='utf-8') as f:
        lector = csv.DictReader(f)
        for fila in lector:
            productos.append(fila)
    return productos

def buscar_imagen_gratis(ddgs, query):
    # La sintaxis de búsqueda actualizada
    resultados = list(ddgs.images(query, max_results=1))
    return resultados[0]['image'] if resultados else None

def descargar_imagen(url):
    headers = {'User-Agent': 'Mozilla/5.0'}
    respuesta = requests.get(url, headers=headers, timeout=10)
    respuesta.raise_for_status()
    return respuesta.content

def remover_fondo_ai(img_bytes, sesion):
    return remove(img_bytes, session=sesion)

def formatear_y_guardar(img_bytes, ruta_destino):
    img = Image.open(BytesIO(img_bytes)).convert("RGBA")
    lienzo = Image.new("RGBA", (800, 800), (0, 0, 0, 0))
    img.thumbnail((750, 750), Image.Resampling.LANCZOS)
    pos_x = (800 - img.width) // 2
    pos_y = (800 - img.height) // 2
    lienzo.paste(img, (pos_x, pos_y), img)
    lienzo.save(ruta_destino, "WEBP", quality=80)

if __name__ == '__main__':
    procesar_catalogo()