# =====================================================================
# PHAT HANH BAN MOI LEN GITHUB RELEASES
#
# App tren may POS tu hoi api.github.com/repos/<repo>/releases/latest.
# Muon may POS thay ban moi, CHI CAN:
#   - build lai APK voi so phien ban lon hon
#   - tao GitHub Release moi kem file .apk do
#
# CHAY:
#   powershell -File publish-release.ps1 -VersionCode 2 -VersionName "1.1.0" -Note "Sua loi tinh tien"
#   powershell -File publish-release.ps1 -VersionCode 2 -VersionName "1.1.0" -SkipBuild
#
# YEU CAU: da cai `gh` (GitHub CLI) va dang nhap (gh auth login)
# =====================================================================
param(
    [Parameter(Mandatory = $true)][int]$VersionCode,
    [Parameter(Mandatory = $true)][string]$VersionName,
    [string]$Note = "",
    [switch]$SkipBuild,
    [switch]$Draft
)

$ErrorActionPreference = "Continue"
$AndroidDir = $PSScriptRoot
$Dist = Join-Path (Split-Path $AndroidDir -Parent) "dist"
$Cfg = Get-Content (Join-Path $AndroidDir "build-config.json") -Raw | ConvertFrom-Json
$Tag = "v$VersionName"

function Fail([string]$m) { Write-Output "LOI: $m"; exit 1 }

# ---------------------------------------------------------------------
# 1. Kiem tra gh CLI
# ---------------------------------------------------------------------
$gh = Get-Command gh -ErrorAction SilentlyContinue
if (-not $gh) { Fail "Khong tim thay 'gh'. Cai GitHub CLI: https://cli.github.com" }
$auth = & gh auth status 2>&1
if ($LASTEXITCODE -ne 0) { Fail "gh chua dang nhap. Chay: gh auth login" }

# ---------------------------------------------------------------------
# 2. CHAN SAI: khong duoc phat hanh ban nho hon ban dang co
# ---------------------------------------------------------------------
# Ly do: may POS so sanh versionCode. Phat hanh ban nho hon se khong bao gio
# duoc cap nhat, va lam nguoi dung ton tai ban cu hon - cau rat kho chieu lai.
$latest = & gh release view --json tagName,isDraft,isPrerelease 2>&1 | ConvertFrom-Json
if ($LASTEXITCODE -eq 0 -and $latest) {
    $latestTag = [string]$latest.tagName
    $latestNum = [int]($latestTag.TrimStart('v'))
    Write-Output "=== BAN DANG CO TREN GITHUB ==="
    Write-Output "  Release moi nhat : $latestTag"
    if ($VersionCode -le $latestNum) {
        Fail "Phien ban moi ($VersionCode) phai LON HON ban dang co ($latestNum). Neu ban cu da ton tai tren may POS, phat hanh ban nho hon se khong bao gio duoc may nao cap nhat."
    }
    Write-Output "  Phien ban moi    : $Tag (code $VersionCode)"
    Write-Output ""
}

# ---------------------------------------------------------------------
# 3. Build APK
# ---------------------------------------------------------------------
if (-not $SkipBuild) {
    Write-Output "=== BUILD APK ==="
    & powershell -ExecutionPolicy Bypass -File (Join-Path $AndroidDir "build-apk.ps1") `
        -VersionCode $VersionCode -VersionName $VersionName
    if ($LASTEXITCODE -ne 0) { Fail "Build APK that bai." }
}

$apk = Join-Path $Dist "milano-pos-$VersionName.apk"
if (-not (Test-Path $apk)) { Fail "Khong tim thay APK: $apk" }
Write-Output ""
Write-Output "=== APK ==="
Write-Output "  $($apk)  ($([math]::Round((Get-Item $apk).Length/1KB,1)) KB)"

# ---------------------------------------------------------------------
# 4. Tao release
# ---------------------------------------------------------------------
if ($Draft) {
    Write-Output "  Tao ban nhap: chi admin thay, may POS CHUA thay ban moi"
} else {
    Write-Output "  Tao release that. Tu gio day may POS se tu tim thay ban moi."
}
Write-Output ""

if (-not $Note) {
    $Note = "MILANO COFFEE POS $VersionName"
}
Write-Output "=== TAO GITHUB RELEASE $Tag ==="

$args = @("release", "create", $Tag, $apk,
          "--title", "MILANO COFFEE POS $VersionName",
          "--notes", $Note,
          "--repo", "$($Cfg.repo)")
if ($Draft) { $args += "--draft" }

& gh @args 2>&1 | ForEach-Object { Write-Output "  $_" }
if ($LASTEXITCODE -ne 0) { Fail "Tao release that bai." }

# Nhet file hash vao release de doi so sanh tam khi tai
$hashFile = "$apk.sha256"
if (Test-Path $hashFile) {
    & gh release upload $Tag $hashFile --repo "$($Cfg.repo)" --clobber 2>&1 | ForEach-Object { Write-Output "  $_" }
}

Write-Output ""
Write-Output "=== XONG ==="
Write-Output "  Release: https://github.com/$($Cfg.repo)/releases/tag/$Tag"
Write-Output ""
Write-Output "  May POS se tu thay ban moi trong vong 6 gio (hoac dung ngay neu mo lai app,"
Write-Output "  hoac goi AndroidCapNhat.kiemTra() tu trong giao dien)."