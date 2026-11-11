# Builds the Android launcher icons (legacy mipmaps) from launcher/build/ranch-logo.png:
# the logo centered on a dark (#0b100c) rounded square with ~10% padding.
#   powershell -ExecutionPolicy Bypass -File launcher\android\scripts\make-icons.ps1
param()
Add-Type -AssemblyName System.Drawing
$android = Split-Path -Parent $PSScriptRoot
$logoPath = Join-Path (Split-Path -Parent $android) 'build\ranch-logo.png'
$res = Join-Path $android 'app\src\main\res'
if (-not (Test-Path $logoPath)) { throw "Missing $logoPath" }
$logo = [System.Drawing.Image]::FromFile($logoPath)

$sizes = @{ 'mdpi' = 48; 'hdpi' = 72; 'xhdpi' = 96; 'xxhdpi' = 144; 'xxxhdpi' = 192 }
foreach ($density in $sizes.Keys) {
  $size = $sizes[$density]
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'; $g.InterpolationMode = 'HighQualityBicubic'; $g.PixelOffsetMode = 'HighQuality'
  $g.Clear([System.Drawing.Color]::Transparent)

  # Rounded square background
  $r = [single]($size * 0.44)   # corner diameter
  $e = [single]($size - 1)
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $p.AddArc([single]0, [single]0, $r, $r, 180, 90); $p.AddArc($e - $r, [single]0, $r, $r, 270, 90)
  $p.AddArc($e - $r, $e - $r, $r, $r, 0, 90); $p.AddArc([single]0, $e - $r, $r, $r, 90, 90); $p.CloseFigure()
  $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 0x0b, 0x10, 0x0c))
  $g.FillPath($brush, $p)

  # Logo, fitted with 10% padding on each side
  $box = $size * 0.8
  $scale = [Math]::Min($box / $logo.Width, $box / $logo.Height)
  $w = $logo.Width * $scale; $h = $logo.Height * $scale
  $g.DrawImage($logo, [single](($size - $w) / 2), [single](($size - $h) / 2), [single]$w, [single]$h)
  $g.Dispose(); $brush.Dispose(); $p.Dispose()

  $dir = Join-Path $res "mipmap-$density"
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $bmp.Save((Join-Path $dir 'ic_launcher.png'), [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host "mipmap-$density/ic_launcher.png ($size px)"
}
$logo.Dispose()
