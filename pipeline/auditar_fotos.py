import csv
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CSV_PATH = os.path.join(BASE_DIR, '../datos/plantilla_fotos.csv')
FOTOS_DIR = os.path.join(BASE_DIR, '../catalogo-web/fotos/')
OUTPUT_FALTANTES = os.path.join(BASE_DIR, '../datos/fotos_faltantes.csv')

def auditar():
    if not os.path.exists(CSV_PATH):
        print(f"[ERROR] No se encontró el archivo: {CSV_PATH}")
        return

    with open(CSV_PATH, mode='r', encoding='utf-8') as f:
        productos = list(csv.DictReader(f))

    if not productos:
        return

    existentes = 0
    faltantes = []

    for prod in productos:
        archivo = prod.get('archivo_foto', '').strip()
        if not archivo:
            continue
            
        ruta_foto = os.path.join(FOTOS_DIR, archivo)
        if os.path.exists(ruta_foto) and os.path.getsize(ruta_foto) > 0:
            existentes += 1
        else:
            faltantes.append(prod)

    # Exportar el delta exacto de faltantes
    campos = list(productos[0].keys())
    with open(OUTPUT_FALTANTES, mode='w', encoding='utf-8', newline='') as f:
        w = csv.DictWriter(f, fieldnames=campos)
        w.writeheader()
        w.writerows(faltantes)

    print("=" * 50)
    print(f"📊 DIAGNÓSTICO DE FOTOGRAFÍAS - ACEROS PEÑASCAL")
    print("=" * 50)
    print(f"✅ Fotos existentes y válidas: {existentes}")
    print(f"❌ Fotos faltantes (Delta):     {len(faltantes)}")
    print(f"📁 Listado de pendientes guardado en: datos/fotos_faltantes.csv")
    print("=" * 50)

if __name__ == '__main__':
    auditar()