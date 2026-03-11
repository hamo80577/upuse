Set-Location "C:\Users\hp\Desktop\UPuse"
Get-Content .env | Where-Object { $_ -match '^[A-Za-z_][A-Za-z0-9_]*=' } | ForEach-Object {
    $name, $value = $_ -split '=', 2
    [Environment]::SetEnvironmentVariable($name, $value, 'Process') }
$env:NODE_ENV = 'production'
npm run build
npm start




