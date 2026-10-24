param(
    [string]$MenuUrl = 'https://bougoisie.tail16554f.ts.net/fanservice/',
    [switch]$Check
)
$ErrorActionPreference = 'Stop'
$menuAddress = $null
if (-not [Uri]::TryCreate($MenuUrl, [UriKind]::Absolute, [ref]$menuAddress) -or
    $menuAddress.Scheme -notin @('http', 'https') -or $menuAddress.UserInfo -or
    ($menuAddress.Scheme -eq 'http' -and -not $menuAddress.IsLoopback)) {
    throw 'Use an HTTPS menu address, or HTTP on localhost.'
}
$browser = @(
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $browser) { throw 'Microsoft Edge was not found. Install Edge to use the desktop companion menu.' }
$profilePath = Join-Path $env:LOCALAPPDATA 'fanservice\CompanionMenuBrowser'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Windows.Forms,System.Drawing -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;
public class FanserviceToolbar : Form {
    public Action ToggleMenu;
    public bool HotkeyRegistered;
    [DllImport("user32.dll")] static extern bool RegisterHotKey(IntPtr window, int id, uint modifiers, uint key);
    [DllImport("user32.dll")] static extern bool UnregisterHotKey(IntPtr window, int id);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr window, int command);
    protected override void OnHandleCreated(EventArgs e) {
        base.OnHandleCreated(e);
        HotkeyRegistered = RegisterHotKey(Handle, 8851, 0x4000, 0x77);
    }
    protected override void OnHandleDestroyed(EventArgs e) {
        if (HotkeyRegistered) UnregisterHotKey(Handle, 8851);
        base.OnHandleDestroyed(e);
    }
    protected override void WndProc(ref Message message) {
        if (message.Msg == 0x0312 && message.WParam.ToInt32() == 8851 && ToggleMenu != null) ToggleMenu();
        base.WndProc(ref message);
    }
}
'@
if ($Check) {
    [pscustomobject]@{menu=$menuAddress.AbsoluteUri; browser=$browser; profile=$profilePath;
        mode='Independent companion window'; gameFilesModified=$false; nativeUPBinding=$false; toolbarCompiled=$true} | ConvertTo-Json
    exit 0
}
$appMutex = New-Object System.Threading.Mutex($false, 'Local\FanserviceCompanionMenu')
if (-not $appMutex.WaitOne(0)) { $appMutex.Dispose(); throw 'The fanservice companion is already running. Use its button or F8.' }
$form = New-Object FanserviceToolbar
$form.Text = 'fanservice companion'
$form.ClientSize = New-Object System.Drawing.Size(390, 134)
$form.FormBorderStyle = 'FixedToolWindow'
$form.MaximizeBox = $false
$form.TopMost = $true
$form.StartPosition = 'CenterScreen'
$form.BackColor = [System.Drawing.Color]::FromArgb(29, 41, 55)
$form.ForeColor = [System.Drawing.Color]::White
$label = New-Object System.Windows.Forms.Label
$label.Text = 'Library, Organization, packs and local playback.'
$label.Location = New-Object System.Drawing.Point(12, 12)
$label.Size = New-Object System.Drawing.Size(365, 28)
$form.Controls.Add($label)
$open = New-Object System.Windows.Forms.Button
$open.Text = 'fanservice menu'
$open.Location = New-Object System.Drawing.Point(12, 45)
$open.Size = New-Object System.Drawing.Size(175, 35)
$form.Controls.Add($open)
$back = New-Object System.Windows.Forms.Button
$back.Text = 'Return to game'
$back.Location = New-Object System.Drawing.Point(200, 45)
$back.Size = New-Object System.Drawing.Size(175, 35)
$form.Controls.Add($back)
$hint = New-Object System.Windows.Forms.Label
$hint.Text = 'F8 opens the menu. Companion progress is separate.'
$hint.Location = New-Object System.Drawing.Point(12, 94)
$hint.Size = New-Object System.Drawing.Size(365, 30)
$form.Controls.Add($hint)
$showError = { param($message) [System.Windows.Forms.MessageBox]::Show($message, 'fanservice companion', 'OK', 'Error') | Out-Null }
$launchMenu = {
    try {
        $arguments = @(('--app="' + $menuAddress.AbsoluteUri + '"'), ('--user-data-dir="' + $profilePath + '"'), '--no-first-run')
        Start-Process -FilePath $browser -ArgumentList $arguments -WindowStyle Normal | Out-Null
        $form.WindowState = 'Minimized'
    } catch { & $showError $_.Exception.Message }
}.GetNewClosure()
$open.Add_Click($launchMenu)
$form.ToggleMenu = [Action]$launchMenu
$back.Add_Click({
    $games = @(Get-Process -Name CockHero -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 })
    if ($games.Count -ne 1) { & $showError 'Open one CockHero game window, then select Return to game.'; return }
    [FanserviceToolbar]::ShowWindow($games[0].MainWindowHandle, 9) | Out-Null
    [FanserviceToolbar]::SetForegroundWindow($games[0].MainWindowHandle) | Out-Null
    $form.WindowState = 'Minimized'
})
$form.Add_Shown({ if (-not $form.HotkeyRegistered) { $hint.Text = 'F8 is already in use. Open the menu with the button.' } })
try { [System.Windows.Forms.Application]::Run($form) }
finally { $form.Dispose(); $appMutex.ReleaseMutex(); $appMutex.Dispose() }
