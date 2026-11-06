param(
    [ValidateSet('Start', 'Stop', 'On', 'Off', 'Status')]
    [string]$Action = 'Start',
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$taskName = 'GreenVillageInventory'
$serverScript = Join-Path $PSScriptRoot 'server.py'

function Get-ServerPython {
    Get-Command python.exe -CommandType Application -ErrorAction Stop |
        Select-Object -First 1 -ExpandProperty Source
}

function Test-InventoryServer($Url) {
    try {
        $result = Invoke-RestMethod -Uri "$Url/api/health" -TimeoutSec 1
        return $result.service -eq 'green-village-inventory'
    } catch {
        return $false
    }
}

try {
    if ($Action -in 'On', 'Off') {
        $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
        $principal = [Security.Principal.WindowsPrincipal]::new($identity)
        if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
            throw 'Run inventory_autostart.bat as administrator from the server account.'
        }
    }

    switch ($Action) {
        'Stop' {
            $pathPattern = [regex]::Escape($serverScript)
            $scriptArgument = '(?:^|\s)(?:"{0}"|{0})(?=\s|$)' -f $pathPattern
            $servers = @(Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
                Where-Object { $_.CommandLine -match $scriptArgument })
            if ($servers.Count -eq 0) {
                Write-Host 'Inventory server is already stopped.'
                break
            }
            Stop-Process -Id $servers.ProcessId
            Write-Host 'Inventory server stopped.'
        }
        'On' {
            if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'dist/index.html'))) {
                throw 'Build the web app first with npm ci and npm run build.'
            }
            $taskAction = New-ScheduledTaskAction -Execute (Get-ServerPython) `
                -Argument ('-u "{0}"' -f $serverScript) -WorkingDirectory $PSScriptRoot
            $taskPrincipal = New-ScheduledTaskPrincipal -UserId $identity.Name -LogonType S4U -RunLevel Limited
            $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) `
                -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew
            Register-ScheduledTask -TaskName $taskName -Action $taskAction -Principal $taskPrincipal `
                -Trigger (New-ScheduledTaskTrigger -AtStartup) -Settings $settings -Force | Out-Null
            Write-Host 'Automatic startup is ON. The server will start on the next Windows boot.'
        }
        'Off' {
            if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
                Disable-ScheduledTask -TaskName $taskName | Out-Null
            }
            Write-Host 'Automatic startup is OFF. A running server continues until it is stopped.'
        }
        'Status' {
            $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
            if ($task -and $task.Settings.Enabled) {
                Write-Host "Automatic startup is ON. Task state: $($task.State)."
            } else {
                Write-Host 'Automatic startup is OFF.'
            }
        }
        'Start' {
            $port = 8080
            $configPath = Join-Path $PSScriptRoot 'server.local.json'
            if (Test-Path -LiteralPath $configPath) {
                $config = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
                if ($null -ne $config.port) { $port = $config.port }
            }
            $url = "http://127.0.0.1:$port"
            if (-not (Test-InventoryServer $url)) {
                $runtime = Join-Path $PSScriptRoot 'runtime'
                New-Item -ItemType Directory -Path $runtime -Force | Out-Null
                $serverError = Join-Path $runtime 'server.stderr.log'
                $process = Start-Process -FilePath (Get-ServerPython) -ArgumentList ('-u "{0}"' -f $serverScript) `
                    -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru `
                    -RedirectStandardOutput (Join-Path $runtime 'server.stdout.log') -RedirectStandardError $serverError
                $deadline = [DateTime]::UtcNow.AddSeconds(15)
                while (-not (Test-InventoryServer $url)) {
                    if ($process.HasExited -or [DateTime]::UtcNow -ge $deadline) {
                        throw "Server did not start. See $serverError"
                    }
                    Start-Sleep -Milliseconds 300
                }
            }
            if (-not $NoBrowser) { Start-Process $url }
            Write-Host "Inventory server is ready at $url"
        }
    }
} catch {
    Write-Host $_.Exception.Message
    exit 1
}
