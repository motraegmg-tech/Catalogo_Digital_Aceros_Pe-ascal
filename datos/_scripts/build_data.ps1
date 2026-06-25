# Genera los datos del catalogo para la PWA + plantilla de fotos por codigo
# Salida: catalogo-web\data\productos.js (autocontenido), productos.json (import futuro), plantilla_fotos.csv
$ErrorActionPreference = 'Stop'
$base   = "C:\Users\super\Documents\Claude\Projects\Empresa MOTRAE\Clientes\01_Cliente_Aceros_Penascal\03_Catalogo Digital\Catalogo_Digital_Repository\Catalogo_Digital"
$csvIn  = Join-Path $base "datos\catalogo_categorizado.csv"
$webDir = Join-Path $base "catalogo-web"
$dataDir= Join-Path $webDir "data"
$null = New-Item -ItemType Directory -Force -Path $dataDir
$null = New-Item -ItemType Directory -Force -Path (Join-Path $webDir "fotos")

$rows = Import-Csv -Path $csvIn -Encoding UTF8

function Slug([string]$s){
  $t = $s.ToUpperInvariant()
  $t = $t.Normalize([Text.NormalizationForm]::FormD)
  $sb = New-Object System.Text.StringBuilder
  foreach($ch in $t.ToCharArray()){
    if([Globalization.CharUnicodeInfo]::GetUnicodeCategory($ch) -ne [Globalization.UnicodeCategory]::NonSpacingMark){ [void]$sb.Append($ch) }
  }
  $t = $sb.ToString() -replace '[^A-Z0-9]','-' -replace '-+','-'
  return $t.Trim('-')
}

$seen = @{}
$prods = New-Object System.Collections.Generic.List[Object]
$plantilla = New-Object System.Collections.Generic.List[Object]
foreach($r in $rows){
  $slug = Slug $r.codigo
  if(-not $slug){ $slug = "P" }
  if($seen.ContainsKey($slug)){ $seen[$slug]++; $slug = "$slug-$($seen[$slug])" } else { $seen[$slug]=0 }
  $foto = "$slug.webp"
  $prods.Add([PSCustomObject]@{
    id   = $slug
    cod  = $r.codigo
    nom  = $r.descripcion
    cat  = $r.categoria
    sub  = $r.tipo
    med  = $r.medidas
    prov = $r.proveedor
    foto = $foto
  })
  $plantilla.Add([PSCustomObject]@{
    codigo=$r.codigo; descripcion=$r.descripcion; categoria=$r.categoria; archivo_foto=$foto
  })
}

# Categorias con conteo y subcategorias
$cats = $prods | Group-Object cat | ForEach-Object {
  $subs = $_.Group | Group-Object sub | ForEach-Object { [PSCustomObject]@{ nombre=$_.Name; n=$_.Count } } | Sort-Object nombre
  [PSCustomObject]@{ nombre=$_.Name; n=$_.Count; subs=$subs }
} | Sort-Object @{e={$_.n};Descending=$true}

$payload = [PSCustomObject]@{
  generado  = (Get-Date).ToString('yyyy-MM-dd')
  total     = $prods.Count
  productos = $prods
  categorias= $cats
}
$json = $payload | ConvertTo-Json -Depth 6 -Compress

$utf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText((Join-Path $dataDir "productos.json"), $json, $utf8)
[System.IO.File]::WriteAllText((Join-Path $dataDir "productos.js"), "window.CATALOGO = $json;", $utf8)
$plantilla | Export-Csv -Path (Join-Path $base "datos\plantilla_fotos.csv") -NoTypeInformation -Encoding UTF8

Write-Output "Productos: $($prods.Count) | Categorias: $($cats.Count)"
Write-Output "productos.js  -> $(Join-Path $dataDir 'productos.js')"
Write-Output "plantilla_fotos.csv -> $(Join-Path $base 'datos\plantilla_fotos.csv')"
Write-Output "--- Categorias (n) ---"
$cats | ForEach-Object { "{0,5}  {1}" -f $_.n, $_.nombre } | Write-Output