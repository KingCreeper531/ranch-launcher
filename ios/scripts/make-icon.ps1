# Builds the iPhone app icon: build/ranch-logo.png centered on a solid #0b100c square,
# 1024x1024 with no alpha channel (the App Store icon rules), at
# ios/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png
param([double]$Padding = 0.12)
Add-Type -AssemblyName System.Drawing
# Finds the visible part of the logo (ignores its transparent margin), so the padding is measured from the bottle itself
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
public static class RanchIconTrim {
  public static Rectangle Visible(Bitmap src) {
    var data = src.LockBits(new Rectangle(0, 0, src.Width, src.Height), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
    var px = new byte[data.Stride * data.Height];
    Marshal.Copy(data.Scan0, px, 0, px.Length);
    src.UnlockBits(data);
    int minX = src.Width, minY = src.Height, maxX = -1, maxY = -1;
    for (int y = 0; y < src.Height; y++)
      for (int x = 0; x < src.Width; x++)
        if (px[y * data.Stride + x * 4 + 3] > 8) {
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
    if (maxX < 0) return new Rectangle(0, 0, src.Width, src.Height);
    return Rectangle.FromLTRB(minX, minY, maxX + 1, maxY + 1);
  }
}
'@

$ios = Split-Path -Parent $PSScriptRoot
$launcher = Split-Path -Parent $ios
$logoFile = Join-Path $launcher 'build\ranch-logo.png'
$outFile = Join-Path $ios 'Resources\Assets.xcassets\AppIcon.appiconset\AppIcon-1024.png'
if (-not (Test-Path $logoFile)) { throw "Missing $logoFile" }

$size = 1024
$logo = [System.Drawing.Image]::FromFile($logoFile)
# 24-bit RGB: the saved PNG has no alpha channel
$bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'; $g.InterpolationMode = 'HighQualityBicubic'; $g.PixelOffsetMode = 'HighQuality'; $g.CompositingQuality = 'HighQuality'
$g.Clear([System.Drawing.Color]::FromArgb(255, 0x0b, 0x10, 0x0c))

$src = [RanchIconTrim]::Visible((New-Object System.Drawing.Bitmap $logo))
$box = $size * (1 - 2 * $Padding)
$scale = [Math]::Min($box / $src.Width, $box / $src.Height)
$w = $src.Width * $scale; $h = $src.Height * $scale
$dest = New-Object System.Drawing.RectangleF ([single](($size - $w) / 2)), ([single](($size - $h) / 2)), ([single]$w), ([single]$h)
$g.DrawImage($logo, $dest, [System.Drawing.RectangleF]$src, [System.Drawing.GraphicsUnit]::Pixel)
$g.Dispose()

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $outFile) | Out-Null
$bmp.Save($outFile, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose(); $logo.Dispose()
"Wrote $outFile"
