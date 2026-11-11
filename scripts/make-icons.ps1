# Builds the launcher's icons.
#   build/icon.png + build/icon.ico : app / taskbar / tray icon (from build/ranch-logo.png if present)
#   renderer/public/icons/ranch.png             : sidebar logo
#   renderer/public/icons/youtube-music.png     : copied from the YouTube Music app
#   renderer/public/icons/coming-soon.png       : neutral "coming soon" tile
param()
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot
$build = Join-Path $root 'build'
$icons = Join-Path $root 'renderer\public\icons'
New-Item -ItemType Directory -Force -Path $build, $icons | Out-Null

function Save-Png($bmp, $path) { $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png) }

# Fits a source image into a transparent square, keeping its proportions.
function Square-From($src, [int]$size) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'; $g.InterpolationMode = 'HighQualityBicubic'; $g.PixelOffsetMode = 'HighQuality'
  $g.Clear([System.Drawing.Color]::Transparent)
  $scale = [Math]::Min($size / $src.Width, $size / $src.Height)
  $w = $src.Width * $scale; $h = $src.Height * $scale
  $g.DrawImage($src, [single](($size - $w) / 2), [single](($size - $h) / 2), [single]$w, [single]$h)
  $g.Dispose()
  return $bmp
}

# Temporary placeholder until build/ranch-logo.png is provided: amber rounded square with an R.
function Placeholder([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'; $g.TextRenderingHint = 'AntiAliasGridFit'
  $g.Clear([System.Drawing.Color]::Transparent)
  $r = [int]($size * 0.22); $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $p.AddArc(0, 0, $r, $r, 180, 90); $p.AddArc($size - $r - 1, 0, $r, $r, 270, 90)
  $p.AddArc($size - $r - 1, $size - $r - 1, $r, $r, 0, 90); $p.AddArc(0, $size - $r - 1, $r, $r, 90, 90); $p.CloseFigure()
  $rect = New-Object System.Drawing.Rectangle 0, 0, $size, $size
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, ([System.Drawing.Color]::FromArgb(255, 242, 163, 58)), ([System.Drawing.Color]::FromArgb(255, 154, 79, 28)), 45.0
  $g.FillPath($brush, $p)
  $font = New-Object System.Drawing.Font 'Segoe UI', ([single]($size * 0.55)), ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
  $sf = New-Object System.Drawing.StringFormat; $sf.Alignment = 'Center'; $sf.LineAlignment = 'Center'
  $g.DrawString('R', $font, [System.Drawing.Brushes]::White, (New-Object System.Drawing.RectangleF 0, 0, $size, $size), $sf)
  $g.Dispose()
  return $bmp
}

$logoFile = Join-Path $build 'ranch-logo.png'
$logo = if (Test-Path $logoFile) { [System.Drawing.Image]::FromFile($logoFile) } else { $null }
$make = { param([int]$s) if ($logo) { Square-From $logo $s } else { Placeholder $s } }

# App icon: PNG + multi-size ICO
$sizes = 256, 64, 48, 32, 24, 16
$pngs = @{}
foreach ($sz in $sizes) {
  $b = & $make $sz
  $ms = New-Object System.IO.MemoryStream
  $b.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $pngs[$sz] = $ms.ToArray()
  if ($sz -eq 256) { Save-Png $b (Join-Path $build 'icon.png'); Save-Png $b (Join-Path $icons 'ranch.png') }
  $b.Dispose()
}
$out = New-Object System.IO.MemoryStream; $w = New-Object System.IO.BinaryWriter $out
$w.Write([UInt16]0); $w.Write([UInt16]1); $w.Write([UInt16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
foreach ($sz in $sizes) {
  $d = if ($sz -ge 256) { 0 } else { $sz }
  $w.Write([byte]$d); $w.Write([byte]$d); $w.Write([byte]0); $w.Write([byte]0); $w.Write([UInt16]1); $w.Write([UInt16]32)
  $w.Write([UInt32]$pngs[$sz].Length); $w.Write([UInt32]$offset); $offset += $pngs[$sz].Length
}
foreach ($sz in $sizes) { $w.Write($pngs[$sz]) }
$w.Flush(); [System.IO.File]::WriteAllBytes((Join-Path $build 'icon.ico'), $out.ToArray())
if ($logo) { $logo.Dispose() }

# YouTube Music card icon: the app's own icon
Copy-Item (Join-Path $root '..\build\icon.png') (Join-Path $icons 'youtube-music.png') -Force

# Coming-soon tile: grey rounded square with a screen glyph
$s = 256
$b = New-Object System.Drawing.Bitmap $s, $s
$g = [System.Drawing.Graphics]::FromImage($b); $g.SmoothingMode = 'AntiAlias'; $g.Clear([System.Drawing.Color]::Transparent)
$g.FillEllipse((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 70, 64, 58))), 8, 8, 240, 240)
$pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 220, 210, 198)), 12
$g.DrawRectangle($pen, 62, 74, 132, 92)
$g.DrawLine($pen, 100, 190, 156, 190)
$g.FillPolygon((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 220, 210, 198))), [System.Drawing.PointF[]]@(
  (New-Object System.Drawing.PointF 116, 100), (New-Object System.Drawing.PointF 116, 140), (New-Object System.Drawing.PointF 148, 120)))
$g.Dispose(); Save-Png $b (Join-Path $icons 'coming-soon.png'); $b.Dispose()

"Icons written ($(if (Test-Path $logoFile) { 'from ranch-logo.png' } else { 'placeholder logo' }))"

