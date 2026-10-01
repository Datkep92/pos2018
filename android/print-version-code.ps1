# In versionCode theo cong thuc trong build-apk.ps1.
# Dung boi test-version-code.js de doi chieu voi ham Java thuc su.
$ErrorActionPreference = "Continue"

$src = Get-Content (Join-Path $PSScriptRoot "build-apk.ps1") -Raw
$s = $src.IndexOf("function VersionCodeTuTen(")
$e = $src.IndexOf('$VerCode = VersionCodeTuTen $VerName')
if ($s -lt 0 -or $e -lt 0) {
    Write-Error "Khong tim thay ham VersionCodeTuTen trong build-apk.ps1"
    exit 1
}
Invoke-Expression $src.Substring($s, $e - $s)

Write-Output "PS_OK"
foreach ($n in @('1.0.0','1.0.1','1.0.9','1.0.10','1.1.0','1.2.3','1.9.9',
                 '1.10.0','2.0.0','0.9.9','10.0.0','v1.0.1','V1.2.3',
                 'abc','','1.0.0-beta','v')) {
    "{0} {1}" -f $n, (VersionCodeTuTen $n)
}