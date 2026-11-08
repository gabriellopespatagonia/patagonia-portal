# Servidor local simples para visualizar o site (modo demonstração).
# Uso:  powershell -ExecutionPolicy Bypass -File servidor-local.ps1   → abre http://localhost:8080
param([int]$Porta = 8080)
$raiz = $PSScriptRoot
$tipos = @{ ".html"="text/html; charset=utf-8"; ".css"="text/css"; ".js"="application/javascript"; ".svg"="image/svg+xml";
            ".json"="application/json"; ".png"="image/png"; ".jpg"="image/jpeg"; ".ico"="image/x-icon"; ".xlsx"="application/octet-stream" }
$http = [System.Net.HttpListener]::new()
$http.Prefixes.Add("http://localhost:$Porta/")
$http.Start()
Write-Host "Patagonia Business rodando em http://localhost:$Porta  (Ctrl+C para parar)"
while ($http.IsListening) {
  $ctx = $http.GetContext()
  $caminho = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart("/")
  if ($caminho -eq "" -or $caminho.EndsWith("/")) { $caminho += "index.html" }
  $arquivo = [System.IO.Path]::GetFullPath((Join-Path $raiz $caminho))
  if ($arquivo.StartsWith($raiz) -and (Test-Path $arquivo -PathType Leaf)) {
    $bytes = [System.IO.File]::ReadAllBytes($arquivo)
    $ext = [System.IO.Path]::GetExtension($arquivo).ToLower()
    $ctx.Response.ContentType = if ($tipos[$ext]) { $tipos[$ext] } else { "application/octet-stream" }
    $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  } else { $ctx.Response.StatusCode = 404 }
  $ctx.Response.Close()
}
