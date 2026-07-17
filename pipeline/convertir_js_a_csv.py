import json
import csv
import os

# Rutas
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
JS_FILE = os.path.join(BASE_DIR, '../catalogo-web/data/productos.js')
CSV_OUTPUT = os.path.join(BASE_DIR, '../datos/productos_para_supabase.csv')

def convertir():
    # 1. Leer el archivo JS y extraer el JSON contenido en window.CATALOGO
    # Quitamos "window.CATALOGO = " para parsearlo como JSON puro
    with open(JS_FILE, 'r', encoding='utf-8') as f:
        content = f.read()
        json_str = content.replace('window.CATALOGO = ', '').strip()
        if json_str.endswith(';'): json_str = json_str[:-1]
        
    data = json.loads(json_str)
    productos = data.get('productos', [])

    # 2. Definir campos para Supabase
    # Mapeo: id (js) -> id, cod (js) -> codigo, nom (js) -> descripcion, etc.
    campos = ['id', 'codigo', 'descripcion', 'categoria', 'subcategoria', 'medidas', 'foto', 'proveedor']

    with open(CSV_OUTPUT, 'w', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=campos)
        writer.writeheader()
        
        for p in productos:
            writer.writerow({
                'id': p.get('id'),
                'codigo': p.get('cod'),
                'descripcion': p.get('nom'),
                'categoria': p.get('cat'),
                'subcategoria': p.get('sub'),
                'medidas': p.get('med'),
                'foto': p.get('foto'),
                'proveedor': p.get('prov')
            })

    print(f"[ÉXITO] Archivo generado: {CSV_OUTPUT}")
    print(f"[INFO] Total de registros: {len(productos)}")

if __name__ == '__main__':
    convertir()