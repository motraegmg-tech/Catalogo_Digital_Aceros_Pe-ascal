import csv
import json
import os
import re
import unicodedata
from datetime import date
from collections import defaultdict

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Rutas de entrada (archivos de nuestra curación)
CSV_BASE = os.path.join(BASE_DIR, '../datos/catalogo_categorizado.csv')
CSV_FASE1 = os.path.join(BASE_DIR, '../datos/recientemente_clasificados.csv')
CSV_FASE2 = os.path.join(BASE_DIR, '../datos/clasificados_fase2.csv')

# Rutas de salida (Frontend PWA y base limpia)
OUT_JS = os.path.join(BASE_DIR, '../catalogo-web/data/productos.js')
OUT_JSON = os.path.join(BASE_DIR, '../catalogo-web/data/productos.json')
OUT_PLANTILLA_FOTOS = os.path.join(BASE_DIR, '../datos/plantilla_fotos.csv')

def crear_slug(s):
    if not s: return "P"
    t = s.upper()
    t = unicodedata.normalize('NFKD', t)
    t = "".join([c for c in t if not unicodedata.combining(c)])
    t = re.sub(r'[^A-Z0-9]', '-', t)
    t = re.sub(r'-+', '-', t).strip('-')
    return t if t else "P"

def sincronizar():
    print("[ARQUITECTURA] Sincronizando pipeline de datos con el Catálogo Web...")

    # 1. Mapear las actualizaciones de nuestras Fases 1 y 2 por Código de Producto
    actualizaciones = {}
    for ruta in [CSV_FASE1, CSV_FASE2]:
        if os.path.exists(ruta):
            with open(ruta, mode='r', encoding='utf-8') as f:
                for fila in csv.DictReader(f):
                    cod = fila.get('codigo', '').strip()
                    cat = fila.get('categoria', '').strip()
                    if cod and cat:
                        actualizaciones[cod] = cat

    # 2. Leer la base original de 3,222 productos y aplicar las mejoras EN SU LUGAR (sin duplicar)
    productos_limpios = {}
    campos = []
    if os.path.exists(CSV_BASE):
        with open(CSV_BASE, mode='r', encoding='utf-8') as f:
            lector = csv.DictReader(f)
            campos = lector.fieldnames
            for fila in lector:
                cod = fila.get('codigo', '').strip()
                # Si el producto fue clasificado por nuestros scripts IA, actualizamos su categoría
                if cod in actualizaciones:
                    fila['categoria'] = actualizaciones[cod]
                productos_limpios[cod] = fila

    print(f"📦 Total unificado y sin duplicados: {len(productos_limpios)} productos reales.")

    # 3. Sobreescribir catalogo_categorizado.csv ya limpio
    with open(CSV_BASE, mode='w', encoding='utf-8', newline='') as f:
        w = csv.DictWriter(f, fieldnames=campos)
        w.writeheader()
        w.writerows(productos_limpios.values())

    # 4. Construir las estructuras para la web (productos.js / productos.json)
    seen_slugs = {}
    prods_web = []
    plantilla_fotos = []

    for fila in productos_limpios.values():
        cod = fila.get('codigo', '').strip()
        slug = crear_slug(cod)
        
        if slug in seen_slugs:
            seen_slugs[slug] += 1
            slug = f"{slug}-{seen_slugs[slug]}"
        else:
            seen_slugs[slug] = 0
            
        foto = f"{slug}.webp"
        
        prods_web.append({
            "id": slug,
            "cod": cod,
            "nom": fila.get('descripcion', ''),
            "cat": fila.get('categoria', ''),
            "sub": fila.get('tipo', fila.get('sub', '')),
            "med": fila.get('medidas', ''),
            "prov": fila.get('proveedor', ''),
            "foto": foto
        })
        
        plantilla_fotos.append({
            "codigo": cod,
            "descripcion": fila.get('descripcion', ''),
            "categoria": fila.get('categoria', ''),
            "archivo_foto": foto
        })

    # 5. Agrupar y contar por Categoría y Subcategoría para la interfaz web
    cats_map = defaultdict(list)
    for p in prods_web:
        cats_map[p['cat']].append(p)

    categorias_web = []
    for cat_nom, items in cats_map.items():
        subs_map = defaultdict(int)
        for p in items:
            subs_map[p['sub']] += 1
        
        subs_list = [{"nombre": k, "n": v} for k, v in sorted(subs_map.items())]
        categorias_web.append({
            "nombre": cat_nom,
            "n": len(items),
            "subs": subs_list
        })

    categorias_web.sort(key=lambda x: x['n'], reverse=True)

    # 6. Generar el payload final y guardar los archivos del Frontend PWA
    payload = {
        "generado": date.today().strftime('%Y-%m-%d'),
        "total": len(prods_web),
        "productos": prods_web,
        "categorias": categorias_web
    }

    os.makedirs(os.path.dirname(OUT_JS), exist_ok=True)
    json_str = json.dumps(payload, ensure_ascii=False, indent=2)
    
    with open(OUT_JSON, mode='w', encoding='utf-8') as f:
        f.write(json_str)
        
    with open(OUT_JS, mode='w', encoding='utf-8') as f:
        f.write(f"window.CATALOGO = {json_str};")
        
    with open(OUT_PLANTILLA_FOTOS, mode='w', encoding='utf-8', newline='') as f:
        w = csv.DictWriter(f, fieldnames=["codigo", "descripcion", "categoria", "archivo_foto"])
        w.writeheader()
        w.writerows(plantilla_fotos)

    print("=" * 60)
    print("🚀 SINCRONIZACIÓN WEB COMPLETADA CON ÉXITO")
    print(f"📄 catalogo-web/data/productos.js -> ¡Actualizado!")
    print(f"📄 catalogo-web/data/productos.json -> ¡Actualizado!")
    print("=" * 60)

if __name__ == '__main__':
    sincronizar()