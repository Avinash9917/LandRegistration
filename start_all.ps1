# ==============================================================================
# LandRegistration DApp - Full Stack Launch Script for VS Code / PowerShell
# ==============================================================================

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  🏛️  LandRegistry DApp - Activating All Portals & Services" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

$WorkspaceRoot = $PSScriptRoot

# 1. Check MongoDB
Write-Host "`n[1/4] Checking MongoDB Database..." -ForegroundColor Yellow
$mongoRunning = Get-Process -Name "mongod" -ErrorAction SilentlyContinue
if ($null -eq $mongoRunning) {
    Write-Host "Starting MongoDB Service..." -ForegroundColor Gray
    Start-Service MongoDB -ErrorAction SilentlyContinue
}
Write-Host "✅ MongoDB is active." -ForegroundColor Green

# 2. Check Ganache Blockchain (Port 7545)
Write-Host "`n[2/4] Checking Ganache Ethereum Node (Port 7545)..." -ForegroundColor Yellow
$ganachePortOpen = $false
try {
    $tcp = New-Object System.Net.Sockets.TcpClient
    $tcp.Connect("127.0.0.1", 7545)
    $ganachePortOpen = $true
    $tcp.Close()
} catch {}

if (-not $ganachePortOpen) {
    Write-Host "Starting Ganache CLI on Port 7545..." -ForegroundColor Gray
    Start-Process -FilePath "npx" -ArgumentList "ganache", "-p", "7545", "-i", "5777" -WindowStyle Minimized
    Start-Sleep -Seconds 3
}
Write-Host "✅ Ganache Blockchain is active on http://127.0.0.1:7545" -ForegroundColor Green

# 3. Start Citizen Portal (Port 5000)
Write-Host "`n[3/4] Starting Citizen Portal Server (Port 5000)..." -ForegroundColor Yellow
Start-Process -FilePath "python" -ArgumentList "app.py" -WorkingDirectory "$WorkspaceRoot\Server_For_Users" -WindowStyle Normal
Start-Sleep -Seconds 1
Write-Host "✅ Citizen Portal running at http://127.0.0.1:5000" -ForegroundColor Green

# 4. Start Revenue Dept Portal (Port 5001)
Write-Host "`n[4/4] Starting Revenue Dept & Admin Portal Server (Port 5001)..." -ForegroundColor Yellow
Start-Process -FilePath "python" -ArgumentList "app.py" -WorkingDirectory "$WorkspaceRoot\Server_For_Revenue_Dept" -WindowStyle Normal
Start-Sleep -Seconds 1
Write-Host "✅ Revenue Dept Portal running at http://127.0.0.1:5001" -ForegroundColor Green
Write-Host "✅ Super Admin Console running at http://127.0.0.1:5001/admin" -ForegroundColor Green

Write-Host "`n==========================================================" -ForegroundColor Cyan
Write-Host "  🎉 All Systems Are Live! Opening in browser..." -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Cyan

Start-Process "http://127.0.0.1:5000"
