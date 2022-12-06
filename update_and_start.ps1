Write-Host "Fetching Git Tree..."
git pull 

Write-Host "Launch browser"
Start-Process -WindowStyle Maximized powershell -ArgumentList '-noexit -command "C:\Program` Files\Google\Chrome\Application\chrome.exe http://localhost --kiosk --disable-application-cache "'

Write-Host "Start Servers..."
$pwd = Get-Location
$PORT = "COM3"

$env:PORT_OVERRIDE=$PORT
Start-Process -WindowStyle Maximized powershell -ArgumentList '-noexit -command "Set-Location $pwd; Set-Location server; node index.js"'
Start-Process -WindowStyle Maximized powershell -ArgumentList '-noexit -command "Set-Location $pwd; Set-Location com-scanner-agent; node index.js"'
Start-Process -WindowStyle Maximized powershell -ArgumentList '-noexit -command "Set-Location $pwd; Set-Location frontend; py -m http.server 80"'