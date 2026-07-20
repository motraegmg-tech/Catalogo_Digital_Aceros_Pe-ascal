import csv
import os
import re

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# Ahora leemos el archivo que quedó pendiente del paso anterior
INPUT_CSV = os.path.join(BASE_DIR, '../datos/aun_por_clasificar.csv')
OUTPUT_CLASIFICADOS = os.path.join(BASE_DIR, '../datos/clasificados_fase2.csv')
OUTPUT_RESTANTES = os.path.join(BASE_DIR, '../datos/pendientes_finales.csv')

# 1. HEURÍSTICA DE CAPA 1: REGLAS POR PROVEEDOR (Precisión del 100%)
REGLAS_PROVEEDOR = {
    'ANITA DE LOS SANTOS': 'Herrería, forja y herrajes',
    'FORJA ARTISTICA RENACIMIENTO': 'Herrería, forja y herrajes',
    'CASCAR INTERNATIONAL': 'Herrería, forja y herrajes',
    'ARTEFERRO MONTERREY': 'Herrería, forja y herrajes',
    'GABRIEL REYES GOMEZ': 'Herrería, forja y herrajes',
    'ESAB MEXICO': 'Soldadura (consumibles)',
    'LINCOLN ELECTRIC': 'Soldadura (consumibles)',
    'INFRA': 'Soldadura (consumibles)',
    'GALVATUBING': 'Tubulares',
    'TERNIUM': 'Lámina y cubiertas',
    'PRODUCTOS LAMINADOS': 'Perfiles estructurales'
}

# 2. HEURÍSTICA DE CAPA 2: SUBSTRINGS ENRIQUECIDOS (Sin límites \b para atrapar abreviaturas)
REGLAS_DESCRIPCION = [
    (r'(SOLD\.|ANTORCHA|BOQ|ZAPATA|BORNE|CONECTOR|DIFUSOR|TOBERA|GIS|POSICIONADOR|MICRO A\.)', 'Soldadura (consumibles)'),
    (r'(FLOR|ROSA|HERRADURA|MEDALL|RIZO|ANGEL|BUZON|CENEFA|ELEVADOR|ESLABON|NUDO|TOCA PUERTA|VENADO|LANZA|TEJUELO|AGUILA|CERDO|GARRA|CAPITEL|ALA|APACHE|ARO|BOTON|CABEZA|CONSTELACION|COTORRO|CRESTA|ESTRELLA|FLECHA|GALLO|GOLONDRINA|GRAPA|JARRON|LUNA|MACET|MANZANA|MARIPOSA|NIDO|PALMA|PELDAÑO|PERICO|PLATO|PORTA VELA|RETOÑO|SOL|SOMBRERO|SUPER PICO|SUPER ZAPATO|TORO|TUCAN|VIRGEN|PASAMANOS)', 'Herrería, forja y herrajes'),
    (r'(LAMBRIN|LAM\.|LAMINA|LOUVER|CHAMBRANA|CAJITA|RIEL|TEJA|CUBIERTA|ACANALADA)', 'Lámina y cubiertas'),
    (r'(REJA|REJACERO|RESORTE|RAFIA|TELA MOSQUITERA|CADENA|ALAMBRE|MALLA|CORTINA)', 'Alambre, malla y cercas'),
    (r'(AFLOJA|ACEITE|ESPUMA|CINTA|PRIMARIO|GEL|LIQUIDO|PASTA|SOLUCINTA|ADHESIVO|SILICON|PEGAMENTO|THINNER|SOLVENTE|PINTURA|ESMALTE|WD\.40)', 'Pintura y químicos'),
    (r'(MICA|GOGLE|FAJA|CAPUCHA|PROTECTOR|MANGAS|RESPIRADOR|BOTAS|LENTES|CARETA|OIDOS|GUANTE|CASCO)', 'Seguridad (EPP)'),
    (r'(ESCALERA|ESLINGA|ENGRAPADORA|DESTORNILLADOR|CUÑA|PUNTO|MANERAL|MANDRIL|GAVETA|CAJA PLASTICA|BANCO|RODAJA|TROL|SERRUCHO|PERICO|PERRO|BARRETA|FUMIGADOR|MARTILLO|LLAVE|PINZA|FLEXOMETRO)', 'Herramienta manual'),
    (r'(TALADRO|ESMERIL|CORTADORA|SIERRA|COMPRESOR|SOLDADORA|GENERADOR|BOMBA|ROTOMART|PLASMA|BAT1120|ASPIRADORA|AEROGRAFO)', 'Herramienta eléctrica'),
    (r'(REG |HONGO|BARRIL|COSTILLA|ACOPLADOR|MANGUERA|TUBO|COPLE|NIPLE|CODO|TEE|VALVULA|BRIDA)', 'Tubería y conexiones'),
    (r'(VIGA|HSS|RECTANGULAR|CARAMELO|BIGOTE|PTR|MONTEN|POLIN|ANGULO|SOLERA|CANAL|IPR)', 'Perfiles estructurales'),
    (r'(TORNILLO|PIJA|BIRLO|TUERCA|RONDANA|ARANDELA|TAQUETE|ANCLA|REMACHE|TENSOR)', 'Tornillería y fijación'),
    (r'(DISCO|FLAP|LIJA|CARDA|GRATA|PIEDRA)', 'Abrasivos y discos'),
    (r'(CABLE|EXTENSION|FOCO|LAMPARA|REFLECTOR|CONTACTO|APAGADOR|INTERRUPTOR|TABLERO|PASTILLA|PILA|ALCALINA|LED)', 'Eléctrico e iluminación'),
    (r'(MIRILLA|CIERRA PUERTA|FIJA PUERTA|TOPE|BISAGRA|CERRADURA|CHAPA|JALADERA|MANIJA|PERILLA|PASADOR|CERROJO|CANDADO|MENSULA|ESQUINERO|GARRUCHA|RUEDA|RESBALON)', 'Herrería, forja y herrajes')
]

# Compilamos Regex
REGLAS_COMPILADAS = [(re.compile(patron, re.IGNORECASE), cat) for patron, cat in REGLAS_DESCRIPCION]

def procesar():
    if not os.path.exists(INPUT_CSV):
        print(f"[ERROR] No se encontró {INPUT_CSV}. Asegúrate de haber corrido el script v1.")
        return

    with open(INPUT_CSV, mode='r', encoding='utf-8') as f:
        productos = list(csv.DictReader(f))

    if not productos: return
    campos = list(productos[0].keys())
    if 'categoria' not in campos: campos.append('categoria')

    clasificados = []
    pendientes = []

    for prod in productos:
        prov = prod.get('proveedor', '').strip().upper()
        desc = prod.get('descripcion', '').strip()
        cat_asignada = None

        # 1. Evaluar por Proveedor
        for prov_clave, cat in REGLAS_PROVEEDOR.items():
            if prov_clave in prov:
                cat_asignada = cat
                break
        
        # 2. Si el proveedor no definió la categoría, evaluar por Regex Enriquecido
        if not cat_asignada:
            for regex, cat in REGLAS_COMPILADAS:
                if regex.search(desc):
                    cat_asignada = cat
                    break

        if cat_asignada:
            prod['categoria'] = cat_asignada
            clasificados.append(prod)
        else:
            pendientes.append(prod)

    # Guardar resultados
    with open(OUTPUT_CLASIFICADOS, 'w', encoding='utf-8', newline='') as f:
        w = csv.DictWriter(f, fieldnames=campos)
        w.writeheader()
        w.writerows(clasificados)

    with open(OUTPUT_RESTANTES, 'w', encoding='utf-8', newline='') as f:
        w = csv.DictWriter(f, fieldnames=campos)
        w.writeheader()
        w.writerows(pendientes)

    print(f"[ÉXITO FASE 2] {len(clasificados)} productos clasificados automáticamente.")
    print(f"[REMANENTE] Solo quedan {len(pendientes)} productos por curar.")

if __name__ == '__main__':
    procesar()