import csv
import os
import re

# 1. CONFIGURACIÓN DE RUTAS (Rutas absolutas para evitar fallos de ejecución)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
INPUT_CSV = os.path.join(BASE_DIR, '../datos/por_clasificar.csv')
OUTPUT_CLASIFICADOS = os.path.join(BASE_DIR, '../datos/recientemente_clasificados.csv')
OUTPUT_RESTANTES = os.path.join(BASE_DIR, '../datos/aun_por_clasificar.csv')

# 2. REGLAS DE NEGOCIO (Taxonomía de Aceros Peñascal)
# Se usa Regex (\b) para coincidencia exacta de palabras completas
REGLAS_CLASIFICACION = {
    r'\b(SOLD|ANTORCHA|BOQ|ZAPATA|MICRO|ELECTRODO)\b': 'Soldadura',
    r'\b(FLOR|ROSA|HERRADURA|MEDALLON|RIZO|ANGEL|BUZON|FORJA)\b': 'Herrería, forja y herrajes',
    r'\b(GOGLE|FAJA|CAPUCHA|PROTECTOR|LENTE|GUANTE|CASCO|TAPON)\b': 'Seguridad EPP',
    r'\b(HSS|RECTANGULAR|CHAMBRANA|PTR|ANGULO|VIGA|PERFIL)\b': 'Perfiles estructurales',
    r'\b(DISCO|LIJA|CEPILLO|CARBURO)\b': 'Abrasivos'
}

# Compilamos las expresiones regulares una sola vez en memoria para máxima velocidad
REGLAS_COMPILADAS = {
    re.compile(patron, re.IGNORECASE): categoria 
    for patron, categoria in REGLAS_CLASIFICACION.items()
}

# 3. CAPA DE EXTRACCIÓN
def leer_csv(ruta):
    if not os.path.exists(ruta):
        print(f"[ERROR] No se encontró el archivo: {ruta}")
        return []
    with open(ruta, mode='r', encoding='utf-8') as file:
        return list(csv.DictReader(file))

# 4. CAPA DE TRANSFORMACIÓN (Motor NLP Ligero)
def clasificar_productos(productos):
    clasificados = []
    no_clasificados = []

    for prod in productos:
        descripcion = prod.get('descripcion', '')
        categoria_asignada = None

        for patron, categoria in REGLAS_COMPILADAS.items():
            if patron.search(descripcion):
                categoria_asignada = categoria
                break

        if categoria_asignada:
            prod['categoria'] = categoria_asignada
            clasificados.append(prod)
        else:
            no_clasificados.append(prod)

    return clasificados, no_clasificados

# 5. CAPA DE CARGA
def exportar_csv(ruta, datos, campos):
    if not datos: return
    with open(ruta, mode='w', encoding='utf-8', newline='') as file:
        writer = csv.DictWriter(file, fieldnames=campos)
        writer.writeheader()
        writer.writerows(datos)

# 6. ORQUESTADOR PRINCIPAL
def ejecutar_pipeline():
    print("[ARQUITECTURA] Iniciando motor NLP de clasificación...")
    productos = leer_csv(INPUT_CSV)
    
    if not productos:
        return

    # Aseguramos que la columna 'categoria' exista en las cabeceras
    campos = list(productos[0].keys())
    if 'categoria' not in campos:
        campos.append('categoria')

    clasificados, no_clasificados = clasificar_productos(productos)

    exportar_csv(OUTPUT_CLASIFICADOS, clasificados, campos)
    exportar_csv(OUTPUT_RESTANTES, no_clasificados, campos)

    print(f"[ÉXITO] {len(clasificados)} productos clasificados.")
    print(f"[AVISO] {len(no_clasificados)} productos no coincidieron y requieren curación manual.")

if __name__ == '__main__':
    ejecutar_pipeline()