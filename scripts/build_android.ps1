param(
    [switch]$Release
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$guiRoot = Join-Path $repoRoot "gui"
$androidRoot = Join-Path $guiRoot "android"

$javaCandidates = @(
    $env:JAVA_HOME,
    "C:\Program Files\Android\Android Studio\jbr"
) | Where-Object { $_ -and (Test-Path (Join-Path $_ "bin\java.exe")) }

if (-not $javaCandidates) {
    throw "JDK not found. Install Android Studio or set JAVA_HOME."
}

$sdkCandidates = @(
    $env:ANDROID_HOME,
    $env:ANDROID_SDK_ROOT,
    (Join-Path $env:LOCALAPPDATA "Android\Sdk")
) | Where-Object { $_ -and (Test-Path (Join-Path $_ "platforms")) }

if (-not $sdkCandidates) {
    throw "Android SDK not found. Install Android SDK Platform 36 in Android Studio."
}

$env:JAVA_HOME = @($javaCandidates)[0]
$env:ANDROID_HOME = @($sdkCandidates)[0]
$env:ANDROID_SDK_ROOT = @($sdkCandidates)[0]
$env:PATH = "$(Join-Path $env:JAVA_HOME 'bin');$(Join-Path $env:ANDROID_HOME 'platform-tools');$env:PATH"

Push-Location $guiRoot
try {
    npm run android:sync
    if ($LASTEXITCODE -ne 0) { throw "Web asset sync failed." }

    Push-Location $androidRoot
    try {
        $gradleTask = if ($Release) { "bundleRelease" } else { "assembleDebug" }
        & .\gradlew.bat $gradleTask
        if ($LASTEXITCODE -ne 0) { throw "Android build failed: $gradleTask" }
    }
    finally {
        Pop-Location
    }
}
finally {
    Pop-Location
}

$artifactPath = if ($Release) {
    Join-Path $androidRoot "app\build\outputs\bundle\release\app-release.aab"
} else {
    Join-Path $androidRoot "app\build\outputs\apk\debug\app-debug.apk"
}

if (-not (Test-Path $artifactPath)) {
    throw "Android artifact was not found after the build: $artifactPath"
}

if ($Release) {
    Write-Output "AAB (unsigned; configure the application-store signing key before upload): $artifactPath"
} else {
    Write-Output "APK: $artifactPath"
}
