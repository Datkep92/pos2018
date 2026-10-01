# =====================================================================
# BUILD APK - KHONG CAN GRADLE
#
# dung cong cu Android SDK co san (aapt2, d8, zipalign, apksigner) + JDK.
# Vi sao kh dung Gradle: may nay khong co Gradle, tai ca ban Gradle + wrapper
# la mat vai phut moi lan build. Day la duong ngay, dung SDK, dung 1 lan.
#
# CHAY:
#   powershell -File build-apk.ps1
#   powershell -File build-apk.ps1 -VersionCode 2
#
# KET QUA:
#   ../dist/milano-pos-<version>.apk
#   ../dist/milano-pos-<version>.sha256
# =====================================================================
param(
    [int]$VersionCode = 0,
    [string]$VersionName = ""
)

# KHONG dat ErrorActionPreference = "Stop".
# Cong cu Android (javac, d8, apksigner) ghi canh bao ra stderr; PowerShell co
# ErrorActionPreference="Stop" se bien canh bao do thanh LOI va dung script giua
# chung. Thay vao do, moi lenh deu kiem tra $LASTEXITCODE bang tay.
$ErrorActionPreference = "Continue"

# Chay lenh he thong, in output, tra ve exit code. Khong bao gio nem loi.
function Run([string]$exe, [string[]]$argv, [string]$label = "") {
    $out = & $exe @argv 2>&1
    $code = $LASTEXITCODE
    if ($out) {
        foreach ($l in $out) {
            $t = [string]$l
            # Chi in dong canh bao that su, bo qua nhieu
            if ($t -match "error:|ERROR|Exception|FAILED|warning: \[") {
                Write-Output ("  [" + $exe.Split('\')[-1] + "] " + $t.Trim())
            }
        }
    }
    if ($code -ne 0 -and $label) {
        throw "$label that bai (exit $code)"
    }
    return $code
}

$AndroidDir = $PSScriptRoot
$Project    = Split-Path $AndroidDir -Parent        # pos2018/
$Work       = Join-Path $AndroidDir "build"
$Dist       = Join-Path $Project "dist"
$Keystore   = Join-Path $AndroidDir "keystore\pos259.jks"

# ---------------------------------------------------------------------
# Tim cong cu
# ---------------------------------------------------------------------
$Sdk = $env:ANDROID_HOME
if (-not $Sdk) { $Sdk = $env:ANDROID_SDK_ROOT }
if (-not $Sdk) { $Sdk = Join-Path $env:LOCALAPPDATA "Android\Sdk" }
if (-not (Test-Path $Sdk)) { throw "Khong tim thay Android SDK. Dat bien ANDROID_HOME." }

function Find-BuildTools {
    $d = Join-Path $Sdk "build-tools"
    if (-not (Test-Path $d)) { throw "Khong co build-tools trong SDK." }
    $best = Get-ChildItem $d -Directory | Sort-Object { [version]($_.Name -replace '[^0-9.]','') } -Descending | Select-Object -First 1
    return $best.FullName
}
function Find-Platform {
    param([int]$Api)
    $p = Join-Path $Sdk "platforms\android-$Api\android.jar"
    if (Test-Path $p) { return $p }
    # lui ve ban thap hon
    $d = Join-Path $Sdk "platforms"
    $alts = Get-ChildItem $d -Directory | Where-Object { $_.Name -match 'android-(\d+)' -and [int]$Matches[1] -le $Api } |
            Sort-Object { [int]($_.Name -replace 'android-','') } -Descending | Select-Object -First 1
    if ($alts) { return (Join-Path $alts.FullName "android.jar") }
    throw "Khong co android.jar cho API $Api."
}
function Find-Java {
    if ($env:JAVA_HOME -and (Test-Path (Join-Path $env:JAVA_HOME "bin\javac.exe"))) {
        return $env:JAVA_HOME
    }
    $as = "C:\Program Files\Android\Android Studio\jbr"
    if (Test-Path (Join-Path $as "bin\javac.exe")) { return $as }
    foreach ($c in @("C:\Program Files\Java", "C:\Program Files\Eclipse Adoptium")) {
        if (Test-Path $c) {
            $j = Get-ChildItem $c -Directory | Where-Object { $_.Name -match 'jdk|java' } | Select-Object -First 1
            if ($j) { return $j.FullName }
        }
    }
    $cmd = Get-Command javac -ErrorAction SilentlyContinue
    if ($cmd) { return (Split-Path (Split-Path $cmd.Source)) }
    throw "Khong tim thay JDK. Cai Android Studio hoac dat JAVA_HOME."
}

$BT        = Find-BuildTools
$Cfg       = Get-Content (Join-Path $AndroidDir "build-config.json") -Raw | ConvertFrom-Json
$AndroidJar = Find-Platform -Api $Cfg.compileSdk
$JavaHome  = Find-Java

# d8.bat va apksigner.bat la file .bat - chung can JAVA_HOME de tim java.
# Khong dat bien nay, hai lenh do bao loi du du javac/keytool chay duoc.
$env:JAVA_HOME = $JavaHome

$Aapt2    = Join-Path $BT "aapt2.exe"
$D8       = Join-Path $BT "d8.bat"
$Zipalign = Join-Path $BT "zipalign.exe"
$Apksigner= Join-Path $BT "apksigner.bat"
$Keytool  = Join-Path $JavaHome "bin\keytool.exe"
$Javac    = Join-Path $JavaHome "bin\javac.exe"

Write-Output "=== CHUAN BI ==="
Write-Output "  SDK          : $Sdk"
Write-Output "  Build tools  : $(Split-Path $BT -Leaf)"
Write-Output "  android.jar  : $AndroidJar"
Write-Output "  JDK          : $JavaHome"

# ---------------------------------------------------------------------
# Doc / ghi phien ban
# ---------------------------------------------------------------------
if ($VersionCode -gt 0) { $Cfg.versionCode = $VersionCode }
if ($VersionName)       { $Cfg.versionName = $VersionName }
$VerCode = [int]$Cfg.versionCode
$VerName = [string]$Cfg.versionName

# Ghi lai build-config.json de lan sau nho dung version
$Cfg | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $AndroidDir "build-config.json") -Encoding UTF8

# ---------------------------------------------------------------------
# Tao / dung keystore
# ---------------------------------------------------------------------
if (-not (Test-Path $Keystore)) {
    Write-Output ""
    Write-Output "=== TAO KHOA KY (chi mot lan) ==="
    New-Item -ItemType Directory -Force -Path (Split-Path $Keystore) | Out-Null
    Run $Keytool @("-genkeypair",
        "-alias", "pos259",
        "-keyalg", "RSA", "-keysize", "2048",
        "-validity", "10950",
        "-keystore", $Keystore,
        "-storepass", "milanopos259", "-keypass", "milanopos259",
        "-dname", "CN=MILANO COFFEE 259, OU=POS, O=MILANO COFFEE, L=HCM, ST=HCM, C=VN") "keytool" | Out-Null
    Write-Output "  Da tao: $Keystore"
    Write-Output "  !! BACKUP FILE NAY RA NGOAI MACHINE !!"
    Write-Output "  !! Mat file nay = khong the phat hanh ban cap nhat !!"
}

# ---------------------------------------------------------------------
# Chuan bi thu muc assets (dong goi web app vao APK)
# ---------------------------------------------------------------------
if (Test-Path $Work) { Remove-Item $Work -Recurse -Force }
$assetsDir = Join-Path $Work "assets"
New-Item -ItemType Directory -Force -Path $assetsDir | Out-Null

Write-Output ""
Write-Output "=== DONG GOI WEB APP ==="

# Trang HTML can dua vao
foreach ($h in $Cfg.assetHtml) {
    $p = Join-Path $Project $h
    if (Test-Path $p) { Copy-Item $p $assetsDir -Force }
    else { Write-Output "  !! thieu $h" }
}
# Thu muc ban build ma app thuc su nap
# vendor/ = Firebase SDK 8.10.1 ban ES5. KHONG nap tu CDN:
#   - WebView Android 6 mac dinh Chrome 44, Firebase 9.x (gstatic) parse loi
#   - mat mang ho gstatic down thi app chet ngay
foreach ($d in @("js.min", "css.min", "vendor")) {
    $p = Join-Path $Project $d
    if (Test-Path $p) {
        Copy-Item $p (Join-Path $assetsDir $d) -Recurse -Force
        $n = (Get-ChildItem (Join-Path $assetsDir $d) -File).Count
        Write-Output "  $d/ : $n file"
    } else { throw "Thieu thu muc $d." + $(if ($d -ne "vendor") { " Chay 'node ..\build.js' truoc." } else { " Firebase SDK bi thieu - xem android\README-ANDROID.md muc 7." }) }
}

# File so phien ban - app doc de biet dang ban may
$verJson = "{`"versionCode`":$VerCode,`"versionName`":`"$VerName`"}"
Set-Content (Join-Path $assetsDir "version_code.json") $verJson -Encoding UTF8
Write-Output "  version_code.json : $VerJson"

$assetCount = (Get-ChildItem $assetsDir -Recurse -File).Count
$assetKB = [math]::Round(((Get-ChildItem $assetsDir -Recurse -File | Measure-Object Length -Sum).Sum / 1KB), 1)
Write-Output "  Tong assets       : $assetCount file ($assetKB KB)"

# ---------------------------------------------------------------------
# Bien dich tai nguyen
# ---------------------------------------------------------------------
Write-Output ""
Write-Output "=== BIEN DICH TAI NGUON ==="

$resOut = Join-Path $Work "res.zip"
$genDir = Join-Path $Work "gen"
$classesDir = Join-Path $Work "classes"
New-Item -ItemType Directory -Force -Path $genDir, $classesDir | Out-Null

Run $Aapt2 @("compile", "--dir", (Join-Path $AndroidDir "app\res"), "-o", $resOut) "aapt2 compile" | Out-Null

$manifest = Get-Content (Join-Path $AndroidDir "app\AndroidManifest.xml") -Raw
$manifest = $manifest -replace 'android:versionCode="\d+"', "android:versionCode=`"$VerCode`""
$manifest = $manifest -replace 'android:versionName="[^"]*"', "android:versionName=`"$VerName`""
$manifestFile = Join-Path $Work "AndroidManifest.xml"
Set-Content $manifestFile $manifest -Encoding UTF8

$linked = Join-Path $Work "app-unsigned.apk"
# Tai nguyen da bien dich phai truyen o VI TRI DOI SO cuoi.
# Dung co -R se bi aapt2 hieu nham la overlay va bao loi "does not override".
#
# KHONG dung -A $assetsDir: tren Windows, aapt2 copy thu muc assets vao APK
# bang DAU GACH NGUOC ("assets\js.min\db.min.js"). Android chi doc dung dau
# gach XUOC - AssetManager se tra ve loi "file not found" cho moi tep.
# Duoi day nem assets bang ZipFile voi duong dan dung chuan.
& $Aapt2 link `
    -o $linked `
    -I $AndroidJar `
    --manifest $manifestFile `
    --java $genDir `
    --min-sdk-version $Cfg.minSdk `
    --target-sdk-version $Cfg.targetSdk `
    --version-code $VerCode `
    --version-name $VerName `
    $resOut
if ($LASTEXITCODE -ne 0) { throw "aapt2 link that bai." }

$sources = @()
$sources += (Get-ChildItem (Join-Path $AndroidDir "app\src") -Recurse -Filter *.java | ForEach-Object { $_.FullName })
$sources += (Get-ChildItem $genDir -Recurse -Filter *.java | ForEach-Object { $_.FullName })

Run $Javac (@("-nowarn", "-encoding", "UTF-8", "-source", "11", "-target", "11",
              "-classpath", $AndroidJar, "-d", $classesDir) + $sources) "javac" | Out-Null
Write-Output "  Bien dich $(($sources | Measure-Object).Count) file Java: OK"

$dexDir = Join-Path $Work "dex"
New-Item -ItemType Directory -Force -Path $dexDir | Out-Null
Run $D8 (@("--min-api", "$($Cfg.minSdk)", "--output", $dexDir) +
         (Get-ChildItem $classesDir -Recurse -Filter *.class | ForEach-Object { $_.FullName })) "d8" | Out-Null
Write-Output "  Tao classes.dex: OK"

# Nhet classes.dex + toan bo assets vao APK.
# KHONG dung "aapt2 add": build-tools 37 da GO lenh nay (khong con trong
# danh sach subcommand). APK van la file zip - nem bang ZipFile cu .NET.
#
# Duong dan trong zip PHAI dung dau gach xuoc. AssetManager tren Android
# doi chieu ten tep theo dung dau gach xuoc, dung gach nguoc se bao loi.
$dexFile = Join-Path $dexDir "classes.dex"
if (-not (Test-Path $dexFile)) { throw "Khong tim thay classes.dex." }

Add-Type -AssemblyName System.IO.Compression.FileSystem | Out-Null
$zip = [System.IO.Compression.ZipFile]::Open($linked, 'Update')
try {
    # 1. classes.dex
    $old = $zip.GetEntry("classes.dex")
    if ($old) { $old.Delete() }
    $entry = $zip.CreateEntry("classes.dex", [System.IO.Compression.CompressionLevel]::Optimal)
    $es = $entry.Open()
    $bytes = [System.IO.File]::ReadAllBytes($dexFile)
    $es.Write($bytes, 0, $bytes.Length)
    $es.Flush()
    $es.Close()
    Write-Output ("  Nhet classes.dex (" + [math]::Round($bytes.Length/1KB,1) + " KB): OK")

    # 2. assets/ + cac trang web
    $root = $assetsDir.TrimEnd('\') + '\'
    $n = 0
    foreach ($f in (Get-ChildItem $assetsDir -Recurse -File)) {
        $rel = $f.FullName.Substring($root.Length).Replace('\', '/')
        $name = "assets/" + $rel
        $oe = $zip.GetEntry($name)
        if ($oe) { $oe.Delete() }
        $en = $zip.CreateEntry($name, [System.IO.Compression.CompressionLevel]::Optimal)
        $st = $en.Open()
        $b = [System.IO.File]::ReadAllBytes($f.FullName)
        $st.Write($b, 0, $b.Length)
        $st.Flush()
        $st.Close()
        $n++
    }
    Write-Output "  Nhet $n tep assets (duong dan dung dau gach xuoc): OK"
} finally {
    $zip.Dispose()
}

# ---------------------------------------------------------------------
# Can + ky
# ---------------------------------------------------------------------
if (-not (Test-Path $Dist)) { New-Item -ItemType Directory -Force -Path $Dist | Out-Null }
$apkName = "milano-pos-$VerName.apk"
$apkOut  = Join-Path $Dist $apkName

Write-Output ""
Write-Output "=== CAN + KY ==="

Run $Zipalign @("-f", "-p", "4", $linked, $apkOut) "zipalign" | Out-Null

Run $Apksigner @("sign",
    "--ks", $Keystore,
    "--ks-pass", "pass:milanopos259",
    "--key-pass", "pass:milanopos259",
    "--ks-key-alias", "pos259",
    "--min-sdk-version", "$($Cfg.minSdk)",
    "--out", $apkOut, $apkOut) "apksigner sign" | Out-Null

Write-Output "  Xac minh chu ky:"
$vout = & $Apksigner verify --verbose $apkOut 2>&1
foreach ($l in $vout) { Write-Output ("    " + ([string]$l).Trim()) }

# Hash de kiem tra dung khi tai len may
$hash = (Get-FileHash $apkOut -Algorithm SHA256).Hash.ToLower()
Set-Content (Join-Path $Dist "$apkName.sha256") "$hash  $apkName" -Encoding ASCII

$sizeKB = [math]::Round((Get-Item $apkOut).Length / 1KB, 1)
Write-Output ""
Write-Output "=== XONG ==="
Write-Output "  APK    : $apkOut"
Write-Output "  Kich thuoc: $sizeKB KB"
Write-Output "  Phien ban : $VerName (code $VerCode)"
Write-Output "  SHA256   : $hash"
Write-Output ""
Write-Output "  Buoc tiep theo:"
Write-Output "    1. Upload file .apx nay len GitHub Releases (tag v$VerName)"
Write-Output "    2. May POS se tu tim va tai ban moi"