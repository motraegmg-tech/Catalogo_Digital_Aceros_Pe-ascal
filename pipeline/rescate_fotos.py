import csv
import os
import time
import random
import re
import requests
from io import BytesIO
from PIL import Image
from rembg import remove, new_session
from ddgs import DDGS

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
INPUT_FALTANTES = os.path.join(BASE_DIR, '../datos/fotos_faltantes.csv')
FOTOS_DIR = os.path.join(BASE_DIR, '../catalogo-web/fotos/')

# 1. LIMPIEZA INTELIGENTE DE CONSULTAS (NLP / Regex)
def limpiar_query_para_busqueda(descripcion, marca=""):
    # 1. Quitar dimensiones complejas, fracciones y medidas (ej. 1/4", 12.20 MTS, 3X3)
    query = re.sub(r'\b\d+(/\d+)?(\.\d+)?\s*(MM|CM|MTS|MT|PZ|PZA|KG|KGS|LBS|LB|GAL|ML|V|W|HP|AMP)?\b', ' ', descripcion, flags=re.IGNORECASE)
    # 2. Quitar acrónimos y jerga técnica interna de Peñascal
    query = re.sub(r'\b(FO\.CO|FO\.FO|P/|C/|MOD\.|COD\.|REF\.|T/|CAL\.|C-\d+|NUM\.\d+)\b', ' ', query, flags=re.IGNORECASE)
    # 3. Quitar caracteres especiales y exceso de espacios
    query = re.sub(r'[^a-zA-Z0-9\s]', ' ', query)
    query = " ".join(query.split())
    
    # Si la descripción quedó muy corta, le añadimos la marca o la palabra ferretería/acero
    if marca and marca.upper() not in query.upper():
        return f"{marca} {query}".strip()
    return f"{query} ferreteria industrial".strip()

# 2. ORQUESTADOR DE RESCATE
def ejecutar_rescate():
    if not os.path.exists(INPUT_FALTANTES):
        print(f"[ERROR] Primero corre auditar_fotos.py para generar {INPUT_FALTANTES}")
        return

    with open(INPUT_FALTANTES, mode='r', encoding='utf-8') as f:
        pendientes = list(csv.DictReader(f))

    if not pendientes:
        print("[ÉXITO] ¡No hay fotos faltantes! El catálogo está al 100%.")
        return

    print(f"[ARQUITECTURA] Cargando modelo IA local (U2Net) para rescatar {len(pendientes)} fotos...")
    sesion_ia = new_session('u2net')

    with DDGS() as ddgs:
        for i, prod in enumerate(pendientes, 1):
            archivo_destino = prod.get('archivo_foto', '').strip()
            if not archivo_destino: continue
            ruta_final = os.path.join(FOTOS_DIR, archivo_destino)
            if os.path.exists(ruta_final) and os.path.getsize(ruta_final) > 0: continue

            desc_original = prod.get('descripcion', '')
            marca = prod.get('proveedor', '')
            query_limpia = limpiar_query_para_busqueda(desc_original, marca)

            print(f"[{i}/{len(pendientes)}] Rescatando: '{desc_original}'")
            print(f"   ↳ Query refinada: '{query_limpia}'")

            try:
                # Búsqueda con reintento por si hay timeout
                url_img = None
                for intento in range(2):
                    try:
                        resultados = list(ddgs.images(query_limpia, max_results=1))
                        if resultados:
                            url_img = resultados[0]['image']
                            break
                    except Exception as err_busqueda:
                        if intento == 0:
                            time.sleep(4.0) # Esperar si hubo rate-limit
                        else:
                            raise err_busqueda

                if not url_img:
                    print(f"   ⚠️ No se encontró imagen ni con query refinada.")
                    continue

                # Descargar, remover fondo y guardar en WebP
                headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
                resp = requests.get(url_img, headers=headers, timeout=12)
                resp.raise_for_status()

                img_sin_fondo = remove(resp.content, session=sesion_ia)
                
                img = Image.open(BytesIO(img_sin_fondo)).convert("RGBA")
                lienzo = Image.new("RGBA", (800, 800), (0, 0, 0, 0))
                img.thumbnail((750, 750), Image.Resampling.LANCZOS)
                pos_x = (800 - img.width) // 2
                pos_y = (800 - img.height) // 2
                lienzo.paste(img, (pos_x, pos_y), img)
                lienzo.save(ruta_final, "WEBP", quality=80)

                print(f"   ✅ ¡Rescatada y guardada!: {archivo_destino}")
                time.sleep(random.uniform(1.5, 3.0))

            except Exception as e:
                print(f"   ❌ Fallo final en {archivo_destino}: {str(e)[:50]}")

if __name__ == '__main__':
    ejecutar_rescate()