# Bien dich va CHAY THAT ham UpdateChecker.parseVersion, roi doi chieu
# ket qua voi cong thuc trong build-apk.ps1.
#
# Cach nay khong transpile Java sang JS: bien mat nghia thi ca hai deu sai
# ma test van bao PASS. Chay that code thi khong the loi.
param()

$ErrorActionPreference = "Continue"
$AndroidDir = $PSScriptRoot
$Work = Join-Path $AndroidDir "build\test-vc"

# --- tim cong cu ---
$Sdk = $env:ANDROID_HOME
if (-not $Sdk) { $Sdk = $env:ANDROID_SDK_ROOT }
if (-not $Sdk) { $Sdk = Join-Path $env:LOCALAPPDATA "Android\Sdk" }
$bt = Get-ChildItem (Join-Path $Sdk "build-tools") -Directory |
      Sort-Object { [version]($_.Name -replace '[^0-9.]','') } -Descending | Select-Object -First 1
$AndroidJar = Join-Path $Sdk "platforms\android-34\android.jar"

$JavaHome = $env:JAVA_HOME
if (-not $JavaHome -or -not (Test-Path (Join-Path $JavaHome "bin\javac.exe"))) {
    $JavaHome = "C:\Program Files\Android\Android Studio\jbr"
}
$env:JAVA_HOME = $JavaHome

if (Test-Path $Work) { Remove-Item $Work -Recurse -Force }
New-Item -ItemType Directory -Force -Path $Work | Out-Null

# --- sinh R.java bang aapt2 ---
# UpdateChecker tham toi R.string.* nen khong co R.java thi khong bien dich
# duoc. aapt2 link voi --java sinh ra file nay.
$aapt2 = Join-Path $bt.FullName "aapt2.exe"
$resZip = Join-Path $Work "res.zip"
$genDir = Join-Path $Work "gen"
New-Item -ItemType Directory -Force -Path $genDir | Out-Null
& $aapt2 compile --dir (Join-Path $AndroidDir "app\res") -o $resZip 2>&1 | Out-Null
& $aapt2 link -o (Join-Path $Work "t.apk") -I $AndroidJar `
    --manifest (Join-Path $AndroidDir "app\AndroidManifest.xml") `
    --java $genDir --min-sdk-version 21 --target-sdk-version 34 `
    --version-code 1 --version-name "1.0.0" $resZip 2>&1 | Out-Null

# --- bien dich ---
$sources = @()
$sources += (Get-ChildItem (Join-Path $AndroidDir "app\src") -Recurse -Filter *.java | ForEach-Object { $_.FullName })
$sources += (Get-ChildItem $genDir -Recurse -Filter *.java | ForEach-Object { $_.FullName })
$sources += (Join-Path $AndroidDir "test\VersionCheck.java")
$javac = Join-Path $JavaHome "bin\javac.exe"
$out = & $javac -nowarn -encoding UTF-8 -source 11 -target 11 -classpath $AndroidJar -d $Work $sources 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Output "COMPILE_ERROR"
    $out | Select-Object -First 10 | ForEach-Object { Write-Output ("  " + $_) }
    exit 1
}

# --- chay ---
$java = Join-Path $JavaHome "bin\java.exe"
$r = & $java -cp "$Work;$AndroidJar" VersionCheck 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Output "RUN_ERROR"
    $r | ForEach-Object { Write-Output ("  " + $_) }
    exit 1
}

Write-Output "JAVA_OK"
$r | ForEach-Object { Write-Output $_ }