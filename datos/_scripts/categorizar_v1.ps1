# Categorizador V1 (reglas por palabra clave) + correlacion por tipo
# Cliente: Aceros Penascal · MOTRAE · Catalogo Comercial Digital
$ErrorActionPreference = 'Stop'
$base = "C:\Users\super\Documents\Claude\Projects\Empresa MOTRAE\Clientes\01_Cliente_Aceros_Penascal\03_Catalogo Digital\Catalogo_Digital_Repository\Catalogo_Digital\datos"
$csvIn = Join-Path $base "productos_maestro.csv"
$csvOut = Join-Path $base "catalogo_categorizado.csv"
$xlsxOut = Join-Path $base "Correlacion_Proveedores_AcerosPenascal.xlsx"

$rows = Import-Csv -Path $csvIn -Encoding UTF8

# Reglas ordenadas: primer match gana. cat = categoria, sub = tipo, kw = palabras clave (mayuscula)
$rules = @(
  @{cat='Herramienta electrica'; sub='Herramienta electrica'; kw=@('COMPRESOR','ROTOMARTILLO','TALADRO','ESMERILADORA','PULIDORA','CORTADORA','SIERRA','GENERADOR','HIDROLAVADORA','LIJADORA','PLANTA DE SOLD','SOLDADORA','MAQUINA DE SOLD','MOTOSIERRA','DESBROZADORA','ROUTER','PISTOLA DE CALOR','DEMOLEDOR','BARRENADORA','ESMERIL','PLANTA ','MOTOBOMBA','REVOLVEDORA','VIBRADOR','PULIDOR')},
  @{cat='Herramienta manual'; sub='Herramienta manual'; kw=@('MARTILLO','LLAVE','PINZA','DESARMADOR','FLEXOMETRO','CINTA METRICA','CINCEL','SEGUETA','ARCO ','NIVEL','ESCUADRA','PRENSA','REMACHADORA','TIJERA','CARRETILLA',' PALA','MARRO','EXTRACTOR','JUEGO DE','JGO','DADO','MATRACA','CAUTIN','GATO ','BROCA','LIMA','MACHUELO','TENAZA','CORTACIRCULOS','PISTOLA','HOJA','LLANA','ESPATULA','PUNZON','ESCOFINA','CUTTER','NAVAJA','BERBIQUI','CUCHARA','PLANA','DESBASTE MAN','PINZON','CAUTIN','PLATO GIRATORIO')},
  @{cat='Soldadura y abrasivos'; sub='Abrasivos / Discos'; kw=@('DISCO','LIJA','FLAP','PIEDRA ESMERIL','CEPILLO DE ALAMBRE','MONTADA','CONICO','CARDA','GRATA','RUEDA DE')},
  @{cat='Soldadura y abrasivos'; sub='Soldadura (consumibles)'; kw=@('SOLDADURA','ELECTRODO','MICROALAMBRE','FUNDENTE','VARILLA DE BRONCE','BOQUILLA','PUNTA DE CONTACTO')},
  @{cat='Soldadura y abrasivos'; sub='Equipo de soldadura'; kw=@('REGULADOR','PORTAELECTRODO','PINZA DE TIERRA','MANERAL DE SOLD','CARRETE DE ALAMBRE','CARETA DE SOLD')},
  @{cat='Izaje y maniobra'; sub='Izaje y maniobra'; kw=@('ESLINGA','GRILLETE','POLEA','MALACATE','DIFERENCIAL','GUARDACABO','MOTON','APAREJO','ESTROBO','CABLE DE ACERO','CABLE ACERO','SUJETACABLE','SUJETA CABLE','PERRO P/CABLE','PERRO PARA CABLE')},
  @{cat='Tornilleria y fijacion'; sub='Tornilleria y fijacion'; kw=@('TORNILLO','PIJA','BIRLO','TUERCA','RONDANA','ARANDELA','TAQUETE','TAQUET','ANCLA','REMACHE','ESPARRAGO','PERNO',' GRAPA','TENSOR','GANCHO')},
  @{cat='Alambre, malla y cercas'; sub='Alambre, malla y cercas'; kw=@('ALAMBRE','MALLA','CERCA','CICLONICA','GALLINERO','ELECTROSOLDADA','PUAS','CONCERTINA','CLAVO','HILO','SUPER PICO','PICOS','PICO ')},
  @{cat='Lamina y cubiertas'; sub='Lamina y cubiertas'; kw=@('LAMINA','TEJA','POLICARBONATO',' PVC','ACRILICO','TRANSPARENTE','ACANALAD','R101','R72','GALVATECHO','PINTRO','ZINTRO','MULTYTECHO','MULTYPANEL','CABALLETE','TRASLUCID','DUELA','DESPLEGADO','PANEL')},
  @{cat='Perfiles estructurales'; sub='Perfiles estructurales'; kw=@('PTR','MONTEN','POLIN','ANGULO','SOLERA','CANAL','IPR','IPS','IPN',' VIGA','PERFIL','TUBULAR')},
  @{cat='Tuberia y conexiones'; sub='Tuberia y conexiones'; kw=@('TUBO','TUBERIA','CONDUIT','CEDULA','COPLE','NIPLE','CODO','TEE','REDUCCION','VALVULA','CONEXION','BRIDA','UNION','CUELLO')},
  @{cat='Acero (barra y placa)'; sub='Acero (barra y placa)'; kw=@('REDONDO','VARILLA','BARRA','PLACA','COLD ROLL','HOT ROLL','CUADRADO','CORRUGAD',' LISO','BLINDAD','MUSGO','ESTRUCTURAL','INOX')},
  @{cat='Pintura y quimicos'; sub='Pintura y quimicos'; kw=@('PINTURA','PRIMER','ANTICORROSIVO','ESMALTE','THINNER','AGUARRAS','SOLVENTE','BARNIZ','BROCHA','RODILLO','SELLADOR','SILICON','PEGAMENTO','ADHESIVO','MASILLA','RESISTOL','AEROSOL','SPRAY',' LACA','EPOXICO','POXI','RESANA','PRIMARIO')},
  @{cat='Seguridad (EPP)'; sub='Seguridad (EPP)'; kw=@('GUANTE','CARETA','GOGGLE','LENTE','CASCO',' FAJA','MANDIL',' BOTA','RESPIRADOR','TAPON','CHALECO','ARNES','MASCARILLA','PANTALLA','PETO','POLAINA','OREJERA','GAFA','MASCARA')},
  @{cat='Electrico e iluminacion'; sub='Electrico e iluminacion'; kw=@('CABLE','EXTENSION',' FOCO','LAMPARA','CONTACTO','APAGADOR','SOQUET','REFLECTOR','BALASTRA','CINTA DE AISLAR','TABLERO','MODULO','CLAVIJA','PASTILLA','INTERRUPTOR','TIMBRE')}
)

# Extraccion simple de medidas / calibre
$rxList = @(
  '\bC(?:AL)?\.?\s*\d{1,2}\b',
  '\d+\s*\d*/?\d*\s*"',
  '\d+(?:\.\d+)?\s*[xX]\s*\d+(?:\.\d+)?(?:\s*[xX]\s*\d+(?:\.\d+)?)?',
  '\d+(?:\.\d+)?\s*(?:MM|CM|MTS|MT|M)\b',
  '\d+/\d+'
)

$out = New-Object System.Collections.Generic.List[Object]
foreach($r in $rows){
  $d = ($r.descripcion).ToUpperInvariant()
  $cat='POR CLASIFICAR'; $sub='POR CLASIFICAR'
  # --- Categorias prioritarias: Tubulares y Macizos ---
  $special=$true
  if ($d -match 'TUBULAR' -or $d -match '^\s*RECTANGULAR'){
    $cat='Tubulares'
    if ($d -match 'RECTANG'){ $sub='Tubular rectangular' }
    elseif ($d -match 'CUADR'){ $sub='Tubular cuadrado' }
    elseif ($d -match 'REDOND'){ $sub='Tubular redondo' }
    else { $sub='Tubular' }
  }
  elseif ($d -match '^\s*CARAMELO'){ $cat='Macizos'; $sub='Caramelo' }
  elseif ($d -match '^\s*ANGULO'){ $cat='Macizos'; $sub='Angulo' }
  elseif ($d -match '^\s*CUADRAD'){ $cat='Macizos'; $sub='Cuadrado' }
  elseif ($d -match '^\s*REDOND'){ $cat='Macizos'; $sub='Redondo' }
  else { $special=$false }
  if (-not $special){
    foreach($rule in $rules){
      $hit=$false
      foreach($k in $rule.kw){ if ($d -like "*$k*"){ $hit=$true; break } }
      if ($hit){ $cat=$rule.cat; $sub=$rule.sub; break }
    }
  }
  # --- Fallback: Forja artistica / Herrajes (solo sobre lo que quedo sin clasificar) ---
  if ($cat -eq 'POR CLASIFICAR'){
    if ($d -match 'ANGEL|\bSOL\b|SOLES|\bLUNA|ESTRELL|\bFLOR|ALCATRA|MARGARITA|\bGALLO|JINETE|\bLEON|CABALLITO|MEDALLON|RACIMO|\bUVA|MARIPOSA|CORONA|\bCRUZ|COROLA|\bADORNO|ORNAMENT|DRAGON|VENECIA|COLONIAL|BARROCO|HERRADURA|ROSETA|ROSETON|CHAPETON|\bESFERA|\bFIGURA|CANASTILL|\bCANASTA|CARACOL|\bPUNTA|ELEMENTO BALCON|GOTERO|CAPACETE|MOLDURA|BELLOTA|FLORON'){
      $cat='Forja artistica'
      if ($d -match 'CORONA|REMATE'){ $sub='Remate' }
      elseif ($d -match 'ROSETA|ROSETON|CHAPETON'){ $sub='Roseta' }
      else { $sub='Figura ornamental' }
    }
    elseif ($d -match 'HERRAJE|BISAGRA|CERRADUR|\bCHAPA\b|CERROJO|CANDADO|PORTACANDADO|PASADOR|ALDABA|JALADERA|MANIJA|PERILLA|MENSULA|ESQUINERO|GARRUCHA|GOZNE|CANCEL|BARROTE|REJILLA|\bNUMERO|ZOCLO|PORTON|CIERRA ?PUERTA|FIJA ?PUERTA|MIRILLA|\bTOPE|TOCA ?PUERTA|BUZON|PASAMANOS|\bPOSTE|TERMINAL|BIBEL|TEJUELO|CHAMBRANA|\bRUEDA|\bREG\b'){
      $cat='Herrajes'
      if ($d -match 'CERRADUR|\bCHAPA\b|CERROJO|CANDADO|MIRILLA|CIERRA ?PUERTA|FIJA ?PUERTA|\bTOPE|TOCA ?PUERTA|ALDABA|PASADOR|PORTON'){ $sub='Herraje de puerta' }
      elseif ($d -match 'BISAGRA|GOZNE|BIBEL|TEJUELO'){ $sub='Bisagra y pivote' }
      elseif ($d -match 'JALADERA|MANIJA|PERILLA'){ $sub='Jaladera y manija' }
      elseif ($d -match 'CHAMBRANA'){ $sub='Marco y chambrana' }
      elseif ($d -match '\bRUEDA|GARRUCHA'){ $sub='Rodaja y garrucha' }
      elseif ($d -match '\bREG\b'){ $sub='Regaton y contera' }
      elseif ($d -match 'PASAMANOS|\bPOSTE|TERMINAL|BARROTE|REJILLA|CANCEL'){ $sub='Barandal y pasamanos' }
      elseif ($d -match 'MENSULA|ESQUINERO'){ $sub='Soporte y mensula' }
      else { $sub='Herraje' }
    }
  }
  $med = New-Object System.Collections.Generic.List[string]
  foreach($rx in $rxList){
    foreach($m in [regex]::Matches($d,$rx)){ $v=($m.Value -replace '\s+',' ').Trim(); if ($v -and -not $med.Contains($v)){ $med.Add($v) } }
  }
  $out.Add([PSCustomObject]@{
    proveedor=$r.proveedor; codigo=$r.codigo; descripcion=$r.descripcion;
    categoria=$cat; tipo=$sub; medidas=($med -join ' ')
  })
}
$out | Export-Csv -Path $csvOut -NoTypeInformation -Encoding UTF8

$total=$out.Count
$sinClasificar=($out | Where-Object {$_.categoria -eq 'POR CLASIFICAR'}).Count
$pct=[math]::Round(100.0*($total-$sinClasificar)/$total,1)
Write-Output "Productos: $total | Clasificados: $($total-$sinClasificar) ($pct%) | Por clasificar: $sinClasificar"

# Correlacion por TIPO (que proveedores surten cada tipo)
$corr = $out | Where-Object {$_.tipo -ne 'POR CLASIFICAR'} | Group-Object tipo | ForEach-Object {
  $provs = ($_.Group | Select-Object -ExpandProperty proveedor -Unique | Sort-Object)
  [PSCustomObject]@{
    tipo=$_.Name
    categoria=$_.Group[0].categoria
    num_productos=$_.Count
    num_proveedores=$provs.Count
    proveedores=($provs -join ' | ')
  }
} | Sort-Object num_proveedores -Descending

Write-Output "--- Correlacion por tipo ---"
$corr | Select-Object tipo,num_productos,num_proveedores | Format-Table -AutoSize | Out-String | Write-Output

# Construir XLSX con Excel COM (3 hojas)
$excel = $null
try {
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible=$false; $excel.DisplayAlerts=$false
  $wb = $excel.Workbooks.Add()
  while($wb.Worksheets.Count -lt 3){ $wb.Worksheets.Add() | Out-Null }

  # Hoja 1 RESUMEN
  $s1=$wb.Worksheets.Item(1); $s1.Name='RESUMEN'
  $s1.Cells.Item(1,1)='CORRELACION DE PROVEEDORES - ACEROS PENASCAL (MOTRAE)'
  $s1.Cells.Item(2,1)='Generado'; $s1.Cells.Item(2,2)=(Get-Date).ToString('yyyy-MM-dd')
  $s1.Cells.Item(3,1)='Total productos'; $s1.Cells.Item(3,2)=$total
  $s1.Cells.Item(4,1)='Clasificados'; $s1.Cells.Item(4,2)="$($total-$sinClasificar) ($pct%)"
  $s1.Cells.Item(5,1)='Por clasificar'; $s1.Cells.Item(5,2)=$sinClasificar
  $s1.Cells.Item(6,1)='Proveedores'; $s1.Cells.Item(6,2)=(($out|Select-Object -ExpandProperty proveedor -Unique).Count)
  $s1.Cells.Item(7,1)='Tipos surtidos por 2+ proveedores'; $s1.Cells.Item(7,2)=(($corr|Where-Object{$_.num_proveedores -ge 2}).Count)
  $s1.Range('A1').Font.Bold=$true; $s1.Range('A1').Font.Size=13
  $s1.Range('A3:A7').Font.Bold=$true

  # Hoja 2 CORRELACION
  $s2=$wb.Worksheets.Item(2); $s2.Name='CORRELACION_POR_TIPO'
  $hdr=@('TIPO','CATEGORIA','# PRODUCTOS','# PROVEEDORES','PROVEEDORES QUE LO SURTEN')
  for($c=0;$c -lt $hdr.Count;$c++){ $s2.Cells.Item(1,$c+1)=$hdr[$c] }
  $row=2
  foreach($x in $corr){
    $s2.Cells.Item($row,1)=$x.tipo; $s2.Cells.Item($row,2)=$x.categoria
    $s2.Cells.Item($row,3)=$x.num_productos; $s2.Cells.Item($row,4)=$x.num_proveedores
    $s2.Cells.Item($row,5)=$x.proveedores; $row++
  }
  $s2.Range('A1:E1').Font.Bold=$true
  $s2.Range('A1:E1').Interior.Color=2105376
  $s2.Range('A1:E1').Font.Color=16777215
  [void]$s2.Columns.Item(1).AutoFit(); [void]$s2.Columns.Item(2).AutoFit()
  $s2.Columns.Item(5).ColumnWidth=80
  $s2.Application.ActiveWindow.SplitRow=1; $s2.Application.ActiveWindow.FreezePanes=$true

  # Hoja 3 CATALOGO
  $s3=$wb.Worksheets.Item(3); $s3.Name='CATALOGO'
  $h3=@('PROVEEDOR','CODIGO','DESCRIPCION','CATEGORIA','TIPO','MEDIDAS')
  for($c=0;$c -lt $h3.Count;$c++){ $s3.Cells.Item(1,$c+1)=$h3[$c] }
  # volcado rapido por arreglo 2D
  $n=$out.Count; $arr=New-Object 'object[,]' $n,6
  for($i=0;$i -lt $n;$i++){ $o=$out[$i]
    $arr[$i,0]=$o.proveedor; $arr[$i,1]=$o.codigo; $arr[$i,2]=$o.descripcion
    $arr[$i,3]=$o.categoria; $arr[$i,4]=$o.tipo; $arr[$i,5]=$o.medidas }
  $rng=$s3.Range($s3.Cells.Item(2,1), $s3.Cells.Item($n+1,6)); $rng.Value2=$arr
  $s3.Range('A1:F1').Font.Bold=$true
  $s3.Range('A1:F1').Interior.Color=2105376; $s3.Range('A1:F1').Font.Color=16777215
  $s3.Application.ActiveWindow.SplitRow=1; $s3.Application.ActiveWindow.FreezePanes=$true

  if(Test-Path $xlsxOut){ Remove-Item $xlsxOut -Force }
  $wb.SaveAs($xlsxOut, 51)  # 51 = xlsx
  $wb.Close($true); $excel.Quit()
  Write-Output "XLSX -> $xlsxOut"
} catch {
  Write-Output "ERROR XLSX: $($_.Exception.Message)"
} finally {
  if ($excel) { [System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null }
}