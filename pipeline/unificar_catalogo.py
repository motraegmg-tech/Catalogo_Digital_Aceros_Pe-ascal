import csv
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Archivos de entrada
ARCHIVOS_A_UNIR = [
    os.path.join(BASE_DIR, '../datos/catalogo_categorizado.csv'),
    os.path.join(BASE_DIR, '../datos/recientemente_clasificados.csv'),
    os.path.join(BASE_DIR, '../datos/clasificados_fase2.csv')
]

# Archivo de salida maestro unificado
OUTPUT_MAESTRO = os.path.join(BASE_DIR, '../datos/catalogo_maestro_unificado.csv')

def unificar():
    productos_totales = []
    campos = None

    for ruta in ARCHIVOS_A_UNIR:
        if not os.path.exists(ruta):
            print(f"[AVISO] Salto de archivo no encontrado: {os.path.basename(ruta)}")
            continue
            
        with open(ruta, mode='r', encoding='utf-8') as f:
            lector = list(csv.DictReader(f))
            if lector:
                if not campos:
                    campos = list(lector[0].keys())
                productos_totales.extend(lector)

    if not productos_totales:
        return

    # Guardar el maestro unificado
    with open(OUTPUT_MAESTRO, mode='w', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=campos)
        writer.writeheader()
        writer.writerows(productos_totales)

    print("=" * 60)
    print(f"✅ CATÁLOGO UNIFICADO CON ÉXITO")
    print(f"📦 Total de productos listos y clasificados: {len(productos_totales)}")
    print(f"📁 Guardado en: datos/catalogo_maestro_unificado.csv")
    print("=" * 60)

if __name__ == '__main__':
    unificar()