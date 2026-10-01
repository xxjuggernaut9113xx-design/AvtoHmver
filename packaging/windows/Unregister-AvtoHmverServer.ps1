[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('CurrentUser', 'AllUsers')]
    [string]$Scope
)

$ErrorActionPreference = 'Stop'
if ($Scope -eq 'AllUsers') {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Removing the all-users AvtoHmver Server service requires elevation.'
    }
    $service = Get-Service -Name 'AvtoHmverServer' -ErrorAction SilentlyContinue
    if ($service) {
        if ($service.Status -ne [System.ServiceProcess.ServiceControllerStatus]::Stopped) {
            & sc.exe stop AvtoHmverServer | Out-Null
            if ($LASTEXITCODE -notin @(0, 1062)) {
                throw 'Could not stop the AvtoHmver Server Windows service.'
            }
            $service.Refresh()
            $service.WaitForStatus([System.ServiceProcess.ServiceControllerStatus]::Stopped, (New-TimeSpan -Seconds 30))
        }
        & sc.exe delete AvtoHmverServer
        if ($LASTEXITCODE -ne 0) { throw 'Could not remove the AvtoHmver Server Windows service.' }
    }
} else {
    Stop-ScheduledTask -TaskName 'AvtoHmver Server (Current User)' -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName 'AvtoHmver Server (Current User)' -Confirm:$false -ErrorAction SilentlyContinue
}

# Deliberately preserve %LocalAppData%/AvtoHmver and %ProgramData%/AvtoHmver.
# Uninstalling a service must never erase a library, archive, backup, or
# managed P-HAR environment.
