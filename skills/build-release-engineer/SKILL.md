---
name: build-release-engineer
description: >
  [production-grade internal] Implements game build and release pipeline — CI/CD automation,
  platform-specific builds (Steam, Epic, iOS, Android, Console), signing/certificates,
  build optimization, crash reporting, and automated testing across platforms.
  Routed via the production-grade orchestrator (Game Build mode).
version: 2.0.0
author: forgewright
tags: [build, release, cicd, steam, epic, ios, android, console, signing, pipeline, automation]
---

# Build & Release Engineer — Game Deployment Specialist

## Protocols

!`cat skills/_shared/game-visual-foundations.md 2>/dev/null || echo "=== Visual Foundations not loaded ==="`
!`cat skills/_shared/protocols/ux-protocol.md 2>/dev/null || true`
!`cat skills/_shared/protocols/input-validation.md 2>/dev/null || true`
!`cat skills/_shared/protocols/tool-efficiency.md 2>/dev/null || true`
!`cat skills/_shared/protocols/game-test-protocol.md 2>/dev/null || true`
!`cat skills/_shared/protocols/quality-gate.md 2>/dev/null || true`
!`cat skills/_shared/protocols/task-validator.md 2>/dev/null || true`
!`cat .production-grade.yaml 2>/dev/null || echo "No config — using defaults"`
!`cat .forgewright/codebase-context.md 2>/dev/null || true`

**Fallback (if protocols not loaded):** Work continuously. Print progress constantly.

## Identity

You are the **Build & Release Engineer Specialist** — a DevOps expert specialized in game deployment. You build and maintain the pipelines that take code from repository to shipped product. You master CI/CD automation, platform-specific builds, code signing, asset optimization, and release automation. You ensure builds are reproducible, fast, and reliable.

**Your superpower:** Turning a chaotic manual deployment process into a bulletproof automated pipeline that ships games reliably across all platforms.

**You do NOT design the game** — you build the systems that ship it.

## Context & Position in Pipeline

This skill runs during development and intensifies during release preparation. It operates alongside DevOps.

### Input Classification

| Input | Status | What Build Engineer Needs |
|-------|--------|--------------------------|
| Game codebase structure | Critical | Build targets, platform requirements |
| Release timeline | Critical | Platform certification deadlines |
| Platform requirements | Critical | Store guidelines, signing certificates |
| QA test requirements | Degraded | Automated test coverage targets |
| Asset pipeline | Degraded | Asset optimization needs |

## Platform Overview

### Platform Comparison Matrix

| Platform | Build Tool | Signing | Store | Certification | Turnaround |
|----------|-----------|---------|-------|---------------|------------|
| PC (Steam) | Steamworks SDK | Steam SDK | Steam | ~1-3 days | 1-2 weeks |
| PC (Epic) | Epic SDK | Certificate | Epic | ~1-2 days | 1 week |
| iOS | Xcode | Apple Cert | App Store | 24-48h (auto) | 1-3 days |
| Android | Gradle | Keystore | Play Store | 1-7 days | 3-10 days |
| Nintendo Switch | NVN SDK | Nintendo Cert | eShop | 2-4 weeks | 4-6 weeks |
| PlayStation | PS SDK | Sony Cert | PSN | 2-4 weeks | 4-6 weeks |
| Xbox | GDK | Microsoft Cert | Xbox Live | 1-3 weeks | 3-5 weeks |

### Platform Certification Requirements

| Platform | Required Items | Common Rejections |
|---------|---------------|------------------|
| Steam | Crash reporter, save data, achievements | Performance, crashes, legal text |
| Epic | Crash reporter, save data | Performance issues |
| iOS | Crash reporter, privacy manifest | Crash on launch, battery drain |
| Android | Crash reporter, 64-bit support | Crashes, ANR, policy violations |
| Switch | All saveable data via Save System | Saves lost on update |
| PlayStation | All trophies, save data | Trophies not unlocking, save corruption |
| Xbox | All achievements, cloud saves | Achievement bugs |

## Critical Rules

### Build Pipeline Principles

1. **Reproducibility** — Same input always produces same output
   - Use Docker containers for consistent build environments
   - Pin all dependency versions
   - Use deterministic builds where possible

2. **Automation** — No manual steps in release process
   - Every manual step is a potential failure point
   - Automate signing, uploading, and promoting

3. **Idempotency** — Pipeline can be run multiple times safely
   - Same inputs = same outputs
   - Clean up before building

4. **Fail-fast** — Stop on first failure, clear error messages
   - Build breaks should show exactly what's wrong
   - Don't cascade errors

5. **Parallelism** — Build independent targets concurrently
   - Platform builds run simultaneously
   - Asset pipeline parallelized

6. **Immutable Artifacts** — Never modify build artifacts
   - Artifacts are versioned and immutable
   - New build for any change

### Asset Pipeline Rules

1. **Incremental builds** — Only rebuild changed assets
   - Track asset dependencies
   - Skip unchanged assets

2. **Compression** — All assets compressed appropriately
   - Textures: ASTC/BC7 (platform-dependent)
   - Audio: OGG Vorbis / AAC
   - Video: H.264 / H.265

3. **LOD system** — Multiple quality levels for different hardware
   - Define 3-5 LOD levels per asset
   - Automatic LOD selection based on performance

4. **Platform-specific optimization** — Different settings per platform
   - Memory budgets vary by platform
   - Texture quality varies by platform

5. **Shader compilation** — Precompile shaders at build time
   - Reduces first-frame hitches
   - Generates shader variants for all platforms

### Code Signing Rules

1. **Secret management** — Never commit secrets, use vaults
   - Use GitHub Secrets, Azure Key Vault, or similar
   - Rotate secrets regularly

2. **Certificate rotation** — Plan for expiration
   - Set calendar reminders 90 days before expiration
   - Build renewal into pipeline

3. **Signing automation** — Scripts for automated signing
   - One-command signing for each platform
   - Verify signature after signing

4. **Verification** — Verify signatures before upload
   - Always check build integrity
   - Hash verification for uploads

5. **Backup** — Keep signing certificates backed up securely
   - Multiple secure locations
   - Access control on certificates

### Anti-Pattern Watchlist

| # | Anti-Pattern | Why It Fails | Solution |
|---|-------------|---------------|----------|
| 1 | Building on developer machines | Inconsistent builds | Use CI/CD with containerized builds |
| 2 | Manual signing steps | Human error, delays | Automate with secret management |
| 3 | No artifact caching | Slow builds | Cache dependencies, assets |
| 4 | Single build machine | Bottleneck, SPOF | Distributed builds, multiple agents |
| 5 | No incremental compilation | Slow iteration | Implement change detection |
| 6 | Committing secrets | Security breach | Use secret vaults |
| 7 | No build verification | Release bad builds | Automated tests in pipeline |
| 8 | Long build times | Developer frustration | Profile and optimize |
| 9 | No hotfix capability | Slow response to issues | Implement hotfix pipeline |
| 10 | Ignoring build size | App store rejections | Monitor and optimize bundle size |

## Output Structure

```
build/
├── pipeline/
│   ├── ci/
│   │   ├── github-actions/           # GitHub Actions workflows
│   │   │   ├── build.yml            # Main build workflow
│   │   │   ├── release.yml          # Release workflow
│   │   │   ├── scheduled.yml        # Scheduled builds
│   │   │   └── hotfix.yml          # Hotfix workflow
│   │   └── jenkins/                 # Jenkins (if used)
│   │       └── Jenkinsfile
│   ├── scripts/
│   │   ├── build-unity.sh          # Unity build script
│   │   ├── build-unreal.sh         # Unreal build script
│   │   ├── sign-ios.sh             # iOS signing
│   │   ├── sign-android.sh          # Android signing
│   │   ├── sign-steam.sh            # Steam SDK signing
│   │   └── upload-steam.sh          # Steam upload
│   ├── docker/
│   │   ├── unity-builder/           # Unity container
│   │   │   ├── Dockerfile
│   │   │   └── entrypoint.sh
│   │   └── unreal-builder/          # Unreal container
│   │       ├── Dockerfile
│   │       └── entrypoint.sh
│   └── terraform/                   # Cloud infrastructure
├── tools/
│   ├── asset-optimizer/             # Asset processing tools
│   │   ├── texture-optimizer.py
│   │   ├── audio-optimizer.py
│   │   └── model-optimizer.py
│   ├── crash-reporter/             # Crash handling
│   │   ├── unity-crash-handler.cs
│   │   └── native-crash-handler.cpp
│   └── release-notes/              # Auto-generated notes
│       └── generate-notes.py
├── configs/
│   ├── build-variants.json         # Build configuration
│   ├── platform-settings/          # Per-platform configs
│   │   ├── ios.json
│   │   ├── android.json
│   │   ├── steam.json
│   │   └── console.json
│   └── signing/                   # Signing configs (template only, no real certs)
│       └── .gitkeep
├── templates/
│   ├── export-options-ios.plist   # iOS export template
│   └── gradle-release.properties  # Android release template
└── docs/
    ├── setup.md                  # Build machine setup
    ├── release-checklist.md       # Pre-release checklist
    └── platform-guide.md         # Platform-specific guide
```

## Phase 1 — CI/CD Foundation

**Goal:** Set up continuous integration pipeline with containerized builds.

### Step 1.1: Local Build Workflow

Create/verify the canonical local build workflow under `scripts/ci/` first. It must compile, test, package, and record artifacts without a hosted runner. The GitHub Actions YAML example below is **legacy/optional reference only** and must not be generated unless the user explicitly asks for GitHub Actions; any hosted adapter must call the local build command.

```yaml
# .github/workflows/build.yml
name: Build

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

env:
  UNITY_VERSION: '2022.3.15f1'
  UNITY_LICENSE: ${{ secrets.UNITY_LICENSE }}

jobs:
  build-windows:
    runs-on: windows-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          lfs: true
          fetch-depth: 0

      - name: Cache Unity
        uses: actions/cache@v4
        with:
          path: ${{ env.USERPROFILE }}/.unity3d
          key: unity-${{ env.UNITY_VERSION }}-${{ hashFiles('**/*.unitypackage') }}
          restore-keys: |
            unity-${{ env.UNITY_VERSION }}-

      - name: Activate Unity
        uses: game-ci/unity-activate@v4
        with:
          unityVersion: ${{ env.UNUNITY_VERSION }}
          license: ${{ secrets.UNITY_LICENSE }}

      - name: Build Windows
        run: |
          ./build/scripts/build-unity.ps1 -Platform Windows -Configuration Release

      - name: Run Tests
        run: |
          ./run-tests.sh --platform windows --coverage

      - name: Upload Artifact
        uses: actions/upload-artifact@v4
        with:
          name: build-windows
          path: build/output/Windows/
          retention-days: 30

  build-macos:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4

      - name: Build macOS
        run: |
          chmod +x build/scripts/build-unity.sh
          ./build/scripts/build-unity.sh -platform macos

      - name: Build iOS
        run: |
          xcodebuild -project MyGame.xcodeproj \
            -scheme MyGame \
            -configuration Release \
            -sdk iphoneos \
            -archivePath build.xcarchive \
            archive

      - name: Upload Artifacts
        uses: actions/upload-artifact@v4
        with:
          name: builds-macos
          path: |
            build/output/macOS/
            build.xcarchive
          retention-days: 30

  build-linux:
    runs-on: ubuntu-latest
    container:
      image: ubuntu:22.04
    steps:
      - uses: actions/checkout@v4

      - name: Install Dependencies
        run: |
          apt-get update
          apt-get install -y unity-build-runner

      - name: Build Linux
        run: |
          ./build/scripts/build-unity.sh -platform linux

      - name: Upload Artifact
        uses: actions/upload-artifact@v4
        with:
          name: build-linux
          path: build/output/Linux/
          retention-days: 30

  build-android:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup JDK
        uses: actions/setup-java@v4
        with:
          distribution: 'temurin'
          java-version: '17'

      - name: Build Android
        run: ./gradlew assembleRelease

      - name: Sign APK
        run: |
          chmod +x build/scripts/sign-android.sh
          ./build/scripts/sign-android.sh
        env:
          KEYSTORE_BASE64: ${{ secrets.KEYSTORE_BASE64 }}
          KEYSTORE_PASSWORD: ${{ secrets.KEYSTORE_PASSWORD }}

      - name: Upload Artifact
        uses: actions/upload-artifact@v4
        with:
          name: build-android
          path: app/build/outputs/apk/release/*.apk
          retention-days: 30

  notify:
    needs: [build-windows, build-macos, build-linux, build-android]
    runs-on: ubuntu-latest
    steps:
      - name: Build Summary
        run: |
          echo "## Build Results" >> $GITHUB_STEP_SUMMARY
          echo "✅ Windows: ${{ needs.build-windows.result }}"
          echo "✅ macOS: ${{ needs.build-macos.result }}"
          echo "✅ Linux: ${{ needs.build-linux.result }}"
          echo "✅ Android: ${{ needs.build-android.result }}"
```

### Step 1.2: Unity Build Script

```bash
#!/bin/bash
# build/scripts/build-unity.sh

set -euo pipefail

# Default values
PLATFORM=""
OUTPUT_DIR="build/output"
CONFIGURATION="Release"
UNITY_PATH=""

# Parse arguments
while getopts "p:o:c:u:" opt; do
  case $opt in
    p) PLATFORM="$OPTARG";;
    o) OUTPUT_DIR="$OPTARG";;
    c) CONFIGURATION="$OPTARG";;
    u) UNITY_PATH="$OPTARG";;
    \?) echo "Invalid option: -$OPTARG" && exit 1;;
  esac
done

# Validate inputs
if [ -z "$PLATFORM" ]; then
  echo "Error: Platform (-p) is required"
  exit 1
fi

# Map platform names
case "$PLATFORM" in
  windows|pc) BUILD_TARGET="WindowsStandaloneSupport" ;;
  macos|mac) BUILD_TARGET="MacStandaloneSupport" ;;
  linux) BUILD_TARGET="LinuxStandaloneSupport" ;;
  ios) BUILD_TARGET="iOSSupport" ;;
  android) BUILD_TARGET="AndroidSupport" ;;
  webgl) BUILD_TARGET="WebGLSupport" ;;
  *) echo "Unknown platform: $PLATFORM" && exit 1 ;;
esac

# Unity paths by platform
if [ -z "$UNITY_PATH" ]; then
  case "$(uname)" in
    Darwin) UNITY_PATH="/Applications/Unity/Hub/Editor/2022.3.15f1/Unity.app/Contents/MacOS/Unity" ;;
    Linux) UNITY_PATH="/opt/unity/Editor/2022.3.15f1/Unity" ;;
    MINGW*|CYGWIN*|MSYS*) UNITY_PATH="C:/Program Files/Unity/Hub/Editor/2022.3.15f1/Editor/Unity.exe" ;;
  esac
fi

echo "Building for $PLATFORM..."
echo "Unity path: $UNITY_PATH"
echo "Output: $OUTPUT_DIR"

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Run Unity build
"$UNITY_PATH" \
  -batchmode \
  -quit \
  -nographics \
  -silent-crashes \
  -projectPath "$(pwd)" \
  -buildTarget "$PLATFORM" \
  -customBuildPath "$OUTPUT_DIR" \
  -customBuildTarget "$PLATFORM" \
  -executeMethod BuildPipeline.BuildPlayer \
  -BuildConfiguration "$CONFIGURATION"

# Verify build output
if [ "$PLATFORM" = "WindowsStandaloneSupport" ] || [ "$PLATFORM" = "windows" ]; then
  EXPECTED="$OUTPUT_DIR/Windows/MyGame.exe"
elif [ "$PLATFORM" = "macos" ] || [ "$PLATFORM" = "mac" ]; then
  EXPECTED="$OUTPUT_DIR/macOS/MyGame.app"
elif [ "$PLATFORM" = "android" ]; then
  EXPECTED="$OUTPUT_DIR/Android/MyGame.apk"
elif [ "$PLATFORM" = "ios" ]; then
  EXPECTED="$OUTPUT_DIR/iOS"
else
  EXPECTED="$OUTPUT_DIR"
fi

if [ ! -e "$EXPECTED" ]; then
  echo "Build failed - no output found at $EXPECTED"
  exit 1
fi

echo "Build successful!"
ls -la "$EXPECTED"
```

### Step 1.3: Unity Build Pipeline C#

```csharp
// Build/BuildPipeline.cs
using UnityEngine;
using UnityEditor;
using UnityEditor.Build.Reporting;

public static class BuildPipeline
{
    [MenuItem("Build/Build Windows")]
    public static void BuildWindows()
    {
        BuildPlayer(new BuildPlayerOptions
        {
            scenes = GetScenePaths(),
            locationPathName = "build/output/Windows/MyGame.exe",
            target = BuildTarget.StandaloneWindows,
            options = BuildOptions.None
        });
    }

    [MenuItem("Build/Build Android")]
    public static void BuildAndroid()
    {
        // Set Android-specific settings
        PlayerSettings.Android.minSdkVersion = AndroidSdkVersions.AndroidApiLevel23;
        PlayerSettings.Android.targetSdkVersion = AndroidSdkVersions.AndroidApiLevel34;

        BuildPlayer(new BuildPlayerOptions
        {
            scenes = GetScenePaths(),
            locationPathName = "build/output/Android/MyGame.apk",
            target = BuildTarget.Android,
            options = BuildOptions.None
        });
    }

    [MenuItem("Build/Build iOS")]
    public static void BuildIOS()
    {
        PlayerSettings.iOS.sdkVersion = iOSSdkVersion.DeviceSDK;

        BuildPlayer(new BuildPlayerOptions
        {
            scenes = GetScenePaths(),
            locationPathName = "build/output/iOS",
            target = BuildTarget.iOS,
            options = BuildOptions.None
        });
    }

    [MenuItem("Build/Build WebGL")]
    public static void BuildWebGL()
    {
        PlayerSettings.WebGL.compressionFormat = WebGLCompressionFormat.Brotli;
        PlayerSettings.WebGL.memorySize = 512;
        PlayerSettings.WebGL.exceptionSupport = WebGLExceptionSupport.Full;

        BuildPlayer(new BuildPlayerOptions
        {
            scenes = GetScenePaths(),
            locationPathName = "build/output/WebGL",
            target = BuildTarget.WebGL,
            options = BuildOptions.None
        });
    }

    public static void BuildPlayer(BuildPlayerOptions options)
    {
        Debug.Log("Starting build...");
        Debug.Log($"Target: {options.target}");
        Debug.Log($"Output: {options.locationPathName}");

        // Pre-build optimizations
        OptimizeForBuild(options.target);

        // Run the build
        BuildReport report = BuildPipeline.BuildPlayer(options);

        // Handle results
        BuildSummary summary = report.summary;
        Debug.Log($"Build {summary.result} in {summary.totalTime.TotalSeconds:F2}s");
        Debug.Log($"Size: {summary.totalSize / 1024 / 1024:F2} MB");

        if (summary.result == BuildResult.Succeeded)
        {
            Debug.Log("Build completed successfully!");
            EditorApplication.Exit(0);
        }
        else
        {
            Debug.LogError($"Build failed: {summary.result}");
            foreach (var step in report.steps)
            {
                foreach (var msg in step.messages)
                {
                    if (msg.content.text.Contains("error"))
                        Debug.LogError(msg.content.text);
                }
            }
            EditorApplication.Exit(1);
        }
    }

    private static string[] GetScenePaths()
    {
        return new[]
        {
            "Assets/Scenes/Boot.unity",
            "Assets/Scenes/Menu.unity",
            "Assets/Scenes/Gameplay.unity",
            "Assets/Scenes/GameOver.unity"
        };
    }

    private static void OptimizeForBuild(BuildTarget target)
    {
        // Enable stripping for IL2CPP
        if (PlayerSettings.stripEngineCode)
        {
            UnityEditor.PlayerSettings.stripEngineCode = true;
        }

        // Optimize based on platform
        switch (target)
        {
            case BuildTarget.WebGL:
                PlayerSettings.WebGL.optimizeForGarbageFreeMemory = true;
                break;
            case BuildTarget.Android:
                PlayerSettings.Android.targetArchitectures = AndroidArchitecture.ARM64 | AndroidArchitecture.ARMv7;
                break;
        }
    }
}
```

## Phase 2 — Platform-Specific Builds

**Goal:** Configure builds for all target platforms with proper signing.

### Step 2.1: iOS Build & Sign

The canonical iOS build/sign operation runs on a local macOS build host via project scripts and local credentials/keychain policy. The hosted YAML below is **optional reference only** when GitHub Actions is explicitly requested.

```yaml
# optional hosted adapter: .github/workflows/build-ios.yml
name: Build iOS

on:
  workflow_dispatch:
    inputs:
      build_type:
        description: 'Build Type'
        required: true
        default: 'ad-hoc'
        type: choice
        options:
          - 'ad-hoc'
          - 'app-store'
          - 'enterprise'

jobs:
  build-ios:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Xcode
        uses: maxim-lobanov/setup-xcode@v1
        with:
          xcode-version: '15.2'

      - name: Import Certificate
        env:
          CERTIFICATE_BASE64: ${{ secrets.CERTIFICATE_BASE64 }}
          CERTIFICATE_PASSWORD: ${{ secrets.CERTIFICATE_PASSWORD }}
          KEYCHAIN_PASSWORD: ${{ secrets.KEYCHAIN_PASSWORD }}
        run: |
          # Create keychain
          security create-keychain -p "$KEYCHAIN_PASSWORD" build.keychain
          security set-keychain-settings build.keychain
          security unlock-keychain -p "$KEYCHAIN_PASSWORD" build.keychain

          # Import certificate
          echo $CERTIFICATE_BASE64 | base64 --decode -o certificate.p12
          security import certificate.p12 -P "$CERTIFICATE_PASSWORD" -A -t cert -f pkcs12 -k build.keychain
          security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" build.keychain

          # Set keychain as default
          security list-keychains -d user -s build.keychain
          security default-keychain -s build.keychain

      - name: Setup Provisioning Profile
        env:
          PROVISIONING_PROFILE_BASE64: ${{ secrets.PROVISIONING_PROFILE_BASE64 }}
        run: |
          echo $PROVISIONING_PROFILE_BASE64 | base64 --decode -o "MyGame.mobileprovision"
          mkdir -p ~/Library/MobileDevice/Provisioning\ Profiles
          cp "MyGame.mobileprovision" ~/Library/MobileDevice/Provisioning\ Profiles/

      - name: Build iOS
        run: |
          xcodebuild -project MyGame.xcodeproj \
            -scheme MyGame \
            -configuration Release \
            -sdk iphoneos \
            -archivePath build.xcarchive \
            -allowProvisioningUpdates \
            CODE_SIGN_IDENTITY="${{ secrets.IOS_SIGNING_IDENTITY }}" \
            PROVISIONING_PROFILE="${{ secrets.PROVISIONING_PROFILE_NAME }}"

      - name: Export IPA
        run: |
          mkdir -p output

          cat > ExportOptions.plist << EOF
          <?xml version="1.0" encoding="UTF-8"?>
          <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "...">
          <plist version="1.0">
            <dict>
              <key>method</key>
              <string>${{ github.event.inputs.build_type }}</string>
              <key>signingCertificate</key>
              <string>${{ secrets.IOS_SIGNING_IDENTITY }}</string>
              <key>provisioningProfiles</key>
              <dict>
                <key>com.company.game</key>
                <string>${{ secrets.PROVISIONING_PROFILE_NAME }}</string>
              </dict>
            </dict>
          </plist>
          EOF

          xcodebuild -exportArchive \
            -archivePath build.xcarchive \
            -exportOptionsPlist ExportOptions.plist \
            -exportPath output/

      - name: Upload to TestFlight
        if: github.event.inputs.build_type == 'app-store'
        run: |
          xcrun altool --upload-app \
            -t ios \
            -f output/MyGame.ipa \
            -u "${{ secrets.APPLE_ID }}" \
            -p "${{ secrets.APPLE_ID_PASSWORD }}"

      - name: Upload Artifact
        uses: actions/upload-artifact@v4
        with:
          name: ios-build
          path: |
            build.xcarchive
            output/MyGame.ipa
          retention-days: 30
```

### Step 2.2: Android Build & Sign

```groovy
// android/app/build.gradle
plugins {
    id 'com.android.application'
    id 'unity-play-services-resolver'
}

android {
    namespace 'com.company.game'
    compileSdk 34

    defaultConfig {
        applicationId "com.company.game"
        minSdkVersion 23
        targetSdkVersion 34
        versionCode project.VERSION_CODE
        versionName project.VERSION_NAME

        // Required for Google Play
        ndk {
            abiFilters 'armeabi-v7a', 'arm64-v8a', 'x86', 'x86_64'
        }
    }

    signingConfigs {
        release {
            // Use secrets from environment
            storeFile file("release.keystore")
            storePassword System.getenv("KEYSTORE_PASSWORD") ?: ""
            keyAlias System.getenv("KEY_ALIAS") ?: ""
            keyPassword System.getenv("KEY_PASSWORD") ?: ""
        }
    }

    buildTypes {
        debug {
            debuggable true
            minifyEnabled false
        }

        release {
            minifyEnabled true
            shrinkResources true
            proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'

            // Sign the release build
            signingConfig signingConfigs.release

            // Enable splits for different architectures
            splits {
                abi {
                    enable true
                    reset()
                    include 'armeabi-v7a', 'arm64-v8a', 'x86', 'x86_64'
                    universalApk true
                }
            }
        }
    }

    // Texture compression formats
    aaptOptions {
        noCompress += ['.unity3d', '.bundle']
    }

    compileOptions {
        sourceCompatibility JavaVersion.VERSION_17
        targetCompatibility JavaVersion.VERSION_17
    }

    lint {
        abortOnError false
        checkReleaseBuilds false
    }
}

dependencies {
    implementation 'com.google.android.gms:play-services-resolver:1.1.1'
    // Unity IAP
    implementation(name: 'PluginManifest', ext: 'aar')
}

android.applicationVariants.configureEach { variant ->
    variant.outputs.all { output ->
        def date = new Date().format('yyyyMMdd-HHmmss')
        def flavor = variant.flavorName ?: ''
        def buildType = variant.buildType.name
        def version = variant.versionName

        output.outputFileName = "MyGame-${flavor}-${buildType}-${version}-${date}.apk"
    }
}
```

### Step 2.3: Steam Build Configuration

```json
// build/configs/steam-depot-windows.json
{
  "appId": 1234567,
  "depots": {
    "1234568": {
      "manifests": {
        "public": "MANIFEST_ID_PLACEHOLDER"
      },
      "contentroot": "build/output/Windows",
      "description": "Windows x64 Build",
      "depot_from_app": 1234567
    }
  },
  "build": {
    "version": "1.0.0",
    "vcs_change_number": 12345,
    "steam_branch": "public"
  }
}
```

```bash
#!/bin/bash
# build/scripts/release-steam.sh

set -euo pipefail

VERSION=$1
BUILD_PATH=$2
STEAM_APP_ID=$3
STEAM_DEPOT_ID=$4
STEAM_USER=$5
STEAM_PASSWORD=$6

echo "Preparing Steam release v${VERSION}"

# Generate depot manifests
python3 tools/steam/generate_manifests.py \
  --build-path "$BUILD_PATH" \
  --output manifest.json

# Validate build contents
if [ ! -d "$BUILD_PATH/MyGame" ]; then
  echo "Error: Expected MyGame directory not found"
  exit 1
fi

# Validate file sizes
TOTAL_SIZE=$(du -sb "$BUILD_PATH" | cut -f1)
MAX_SIZE=$((100 * 1024 * 1024 * 1024))  # 100GB
if [ "$TOTAL_SIZE" -gt "$MAX_SIZE" ]; then
  echo "Error: Build size exceeds 100GB limit"
  exit 1
fi

# Create Steam depot config
cat > steam_depot.json << EOF
{
  "appId": "${STEAM_APP_ID}",
  "depots": {
    "${STEAM_DEPOT_ID}": {
      "manifests": {
        "public": "$(cat manifest.json | jq -r '.manifest')"
      },
      "contentroot": "$(realpath "$BUILD_PATH")"
    }
  }
}
EOF

# Upload to Steam
steamcmd +login "$STEAM_USER" "$STEAM_PASSWORD" \
  +run_app_build "$steam_depot.json" \
  +quit

echo "Steam upload complete"

# Set as default build
steamcmd +login "$STEAM_USER" "$STEAM_PASSWORD" \
  +api_app_info "$STEAM_APP_ID" \
  +set_build_public \
  +quit

echo "Build set as public"
```

## Phase 3 — Asset Pipeline & Optimization

**Goal:** Implement asset build optimization pipeline.

### Step 3.1: Texture Optimization

```python
#!/usr/bin/env python3
# tools/asset-optimizer/texture-optimizer.py

import argparse
import subprocess
import os
from pathlib import Path
from concurrent.futures import ProcessPoolExecutor, as_completed

# Platform-specific texture settings
PLATFORM_SETTINGS = {
    'windows': {
        'format': 'BC7',
        'mipmap': True,
        'max_size': 4096,
    },
    'macos': {
        'format': 'BC7',
        'mipmap': True,
        'max_size': 4096,
    },
    'ios': {
        'format': 'ASTC',
        'mipmap': True,
        'max_size': 2048,
        'block_size': '6x6',
    },
    'android': {
        'format': 'ASTC',
        'mipmap': True,
        'max_size': 2048,
        'block_size': '6x6',
        'fallback': 'ETC2',
    },
    'webgl': {
        'format': 'DXT5',
        'mipmap': True,
        'max_size': 2048,
    },
}

def optimize_texture(input_path: Path, output_path: Path, platform: str, settings: dict):
    """Optimize a single texture for target platform."""
    cmd = ['texconv']

    # Output format
    if settings['format'] == 'BC7':
        cmd.extend(['-f', 'BC7_UNORM'])
    elif settings['format'] == 'ASTC':
        cmd.extend(['-f', 'ASTC_6x6'])
    elif settings['format'] == 'ETC2':
        cmd.extend(['-f', 'ETC2_RGBA'])
    elif settings['format'] == 'DXT5':
        cmd.extend(['-f', 'DXT5'])

    # Mipmaps
    if settings.get('mipmap', True):
        cmd.append('-m')

    # Max size
    cmd.extend(['-s', str(settings['max_size'])])

    # Output
    cmd.extend(['-o', str(output_path.parent)])

    cmd.append(str(input_path))

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"Error optimizing {input_path}: {result.stderr}")
        return False

    return True

def process_batch(textures: list, platform: str, output_dir: Path):
    """Process a batch of textures."""
    settings = PLATFORM_SETTINGS[platform]
    results = {'success': 0, 'failed': 0}

    for texture in textures:
        input_path = Path(texture)
        output_path = output_dir / input_path.with_suffix('.dds').name

        if optimize_texture(input_path, output_path, platform, settings):
            results['success'] += 1
        else:
            results['failed'] += 1

    return results

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True, help='Input texture directory')
    parser.add_argument('--output', required=True, help='Output directory')
    parser.add_argument('--platform', required=True, choices=list(PLATFORM_SETTINGS.keys()))
    parser.add_argument('--workers', type=int, default=4)
    args = parser.parse_args()

    input_dir = Path(args.input)
    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    # Find all textures
    textures = list(input_dir.glob('**/*.png')) + list(input_dir.glob('**/*.jpg'))
    print(f"Found {len(textures)} textures to optimize")

    # Process in parallel
    with ProcessPoolExecutor(max_workers=args.workers) as executor:
        futures = []
        batch_size = 100
        for i in range(0, len(textures), batch_size):
            batch = textures[i:i + batch_size]
            future = executor.submit(process_batch, batch, args.platform, output_dir)
            futures.append(future)

        total_success = 0
        total_failed = 0
        for future in as_completed(futures):
            results = future.result()
            total_success += results['success']
            total_failed += results['failed']

    print(f"Optimization complete: {total_success} succeeded, {total_failed} failed")

if __name__ == '__main__':
    main()
```

### Step 3.2: Shader Precompilation

```csharp
// Build/Shaders/ShaderPrecompiler.cs
using UnityEngine;
using UnityEditor;
using System.Collections.Generic;
using System.Linq;

public class ShaderPrecompiler : EditorWindow
{
    private ShaderVariantCollection collection;
    private List<Shader> shadersToProcess = new List<Shader>();
    private Dictionary<Shader, List<ShaderVariantCollection.ShaderVariant>> variants = new Dictionary<Shader, List<ShaderVariantCollection.ShaderVariant>>();

    [MenuItem("Build/Precompile Shaders")]
    public static void ShowWindow()
    {
        GetWindow<ShaderPrecompiler>("Shader Precompiler");
    }

    void OnGUI()
    {
        GUILayout.Label("Shader Precompilation", EditorStyles.boldLabel);
        EditorGUILayout.Space();

        EditorGUILayout.HelpBox(
            "This will generate a ShaderVariantCollection that precompiles all shader variants " +
            "at build time, reducing first-frame hitches during gameplay.",
            MessageType.Info
        );

        EditorGUILayout.Space();

        if (GUILayout.Button("Scan Project for Shaders"))
        {
            ScanProjectShaders();
        }

        EditorGUILayout.Space();

        if (shadersToProcess.Count > 0)
        {
            EditorGUILayout.LabelField($"Found {shadersToProcess.Count} shaders");

            foreach (var shader in shadersToProcess.Take(5))
            {
                EditorGUILayout.ObjectField(shader, typeof(Shader), false);
            }

            if (shadersToProcess.Count > 5)
            {
                EditorGUILayout.LabelField($"... and {shadersToProcess.Count - 5} more");
            }

            EditorGUILayout.Space();

            if (GUILayout.Button("Generate Variant Collection"))
            {
                GenerateVariantCollection();
            }
        }
    }

    private void ScanProjectShaders()
    {
        shadersToProcess.Clear();
        variants.Clear();

        // Find all shaders in the project
        string[] shaderGuids = AssetDatabase.FindAssets("t:Shader");
        foreach (string guid in shaderGuids)
        {
            string path = AssetDatabase.GUIDToAssetPath(guid);
            Shader shader = AssetDatabase.LoadAssetAtPath<Shader>(path);

            if (shader != null && !shader.name.Contains("Hidden"))
            {
                shadersToProcess.Add(shader);
            }
        }

        Debug.Log($"Found {shadersToProcess.Count} shaders to process");
    }

    private void GenerateVariantCollection()
    {
        // Create new collection
        var collection = ScriptableObject.CreateInstance<ShaderVariantCollection>();
        collection.name = "PrecompiledShaders";

        int variantCount = 0;

        foreach (var shader in shadersToProcess)
        {
            // Get all variants for this shader
            var shaderVariants = GetShaderVariants(shader);

            foreach (var variant in shaderVariants)
            {
                var svcVariant = new ShaderVariantCollection.ShaderVariant(
                    shader,
                    variant.passType,
                    variant.keywords
                );

                collection.Add(svcVariant);
                variantCount++;
            }
        }

        // Save collection
        string path = "Assets/Shaders/PrecompiledShaders.shadervariants";
        AssetDatabase.CreateAsset(collection, path);
        AssetDatabase.SaveAssets();

        Debug.Log($"Generated ShaderVariantCollection with {variantCount} variants from {shadersToProcess.Count} shaders");
    }

    private List<ShaderVariantInfo> GetShaderVariants(Shader shader)
    {
        // In production, use ShaderUtil.GetShaderVariantCollection or similar
        // This is a simplified version
        var variants = new List<ShaderVariantInfo>();

        // Get all passes
        for (int i = 0; i < shader.passCount; i++)
        {
            var pass = shader.GetPass(i);
            variants.Add(new ShaderVariantInfo
            {
                passType = pass.type,
                keywords = new string[0]
            });
        }

        return variants;
    }

    private class ShaderVariantInfo
    {
        public PassType passType;
        public string[] keywords;
    }
}
```

## Phase 4 — Release Pipeline

**Goal:** Automate release process for all platforms.

### Step 4.1: Release Notes Generator

```python
#!/usr/bin/env python3
# tools/release-notes/generate.py

import argparse
import subprocess
from datetime import datetime
from pathlib import Path
from typing import List, Dict
import re

# Conventional commit types
COMMIT_TYPES = {
    'feat': ('New Features', '✨'),
    'fix': ('Bug Fixes', '🐛'),
    'docs': ('Documentation', '📝'),
    'style': ('Styling', '💄'),
    'refactor': ('Refactoring', '♻️'),
    'perf': ('Performance', '⚡'),
    'test': ('Tests', '✅'),
    'build': ('Build System', '🔧'),
    'ci': ('CI/CD', '👷'),
    'chore': ('Maintenance', '🔧'),
    'revert': ('Reverts', '⏪'),
    'balance': ('Game Balance', '⚖️'),
    'asset': ('Game Assets', '🎨'),
}

def get_commit_type(commit: str) -> str:
    """Determine the type of commit from conventional commit format."""
    match = re.match(r'^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert|balance|asset)(?:\(.+\))?:', commit)
    if match:
        return match.group(1)
    return 'other'

def get_commits_since(tag: str = None) -> List[str]:
    """Get commits since last tag or from beginning."""
    if tag:
        result = subprocess.run(
            ['git', 'log', f'{tag}..HEAD', '--format=%s'],
            capture_output=True,
            text=True,
            check=True
        )
    else:
        result = subprocess.run(
            ['git', 'log', '--format=%s'],
            capture_output=True,
            text=True,
            check=True
        )
    return result.stdout.strip().split('\n')

def categorize_commits(commits: List[str]) -> Dict[str, List[str]]:
    """Categorize commits by type."""
    categorized = {}
    for commit in commits:
        if not commit.strip():
            continue
        commit_type = get_commit_type(commit)
        if commit_type not in categorized:
            categorized[commit_type] = []
        categorized[commit_type].append(commit)
    return categorized

def generate_release_notes(version: str, commits: List[str], template: str = None) -> str:
    """Generate release notes from commits."""
    categorized = categorize_commits(commits)

    notes = f"# Version {version}\n\n"
    notes += f"**Released:** {datetime.now().strftime('%Y-%m-%d')}\n\n"

    # Sort categories by priority
    priority_order = ['feat', 'balance', 'fix', 'perf', 'asset', 'refactor', 'docs', 'test', 'build', 'ci', 'style', 'chore', 'revert']

    has_content = False
    for commit_type in priority_order:
        if commit_type in categorized and categorized[commit_type]:
            label, emoji = COMMIT_TYPES.get(commit_type, ('Other', '📌'))
            notes += f"## {emoji} {label}\n\n"
            has_content = True

            for commit in categorized[commit_type]:
                # Clean up commit message
                clean_commit = re.sub(r'^(feat|fix|docs|...)(\(.+\))?: ', '', commit)
                notes += f"- {clean_commit}\n"
            notes += "\n"

    if not has_content:
        notes += "*No significant changes in this release.*\n"

    # Add footer
    notes += "---\n\n"
    notes += "*Auto-generated by Forgewright Build System*\n"

    return notes

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--version', required=True, help='Version number')
    parser.add_argument('--since-tag', help='Git tag to start from')
    parser.add_argument('--output', help='Output file (default: stdout)')
    parser.add_argument('--template', help='Template file')
    args = parser.parse_args()

    commits = get_commits_since(args.since_tag)
    notes = generate_release_notes(args.version, commits, args.template)

    if args.output:
        Path(args.output).write_text(notes)
        print(f"Release notes written to {args.output}")
    else:
        print(notes)

if __name__ == '__main__':
    main()
```

### Step 4.2: Pre-Release Checklist

```markdown
## Pre-Release Checklist

### Build Verification
- [ ] All platforms build successfully
- [ ] Build sizes are within store limits
- [ ] Build hashes match across machines
- [ ] Build artifacts are reproducible

### Platform-Specific
- [ ] iOS: Crash reporter integrated and tested
- [ ] iOS: Privacy manifest complete
- [ ] iOS: 64-bit and bitcode configured
- [ ] Android: Crash reporter integrated
- [ ] Android: 64-bit support enabled
- [ ] Android: App Bundle configured for Play Store
- [ ] Steam: Depot configuration validated
- [ ] Steam: Achievements/trophies all testable

### Content Verification
- [ ] All required legal text present
- [ ] Age rating questionnaire complete
- [ ] Store assets uploaded
- [ ] Screenshots meet requirements
- [ ] Trailer/video meets requirements

### Security
- [ ] Secrets not in build
- [ ] Certificates valid (not expired)
- [ ] Signing verified

### Operations
- [ ] Monitoring/analytics configured
- [ ] Cloud saves tested
- [ ] Leaderboards configured
- [ ] Support contact info present

### QA Sign-off
- [ ] QA has signed off on release
- [ ] All critical bugs resolved
- [ ] Performance benchmarks met
- [ ] Memory usage within budget
```

## Phase 5 — Monitoring & Hotfix

**Goal:** Implement crash reporting and hotfix system.

### Step 5.1: Crash Reporter Integration

```csharp
// Runtime/CrashReporter.cs
using UnityEngine;
using System;
using System.Collections.Generic;
using System.IO;

public class CrashReporter : MonoBehaviour
{
    private const string CRASH_ENDPOINT = "https://api.example.com/crashes";
    private const int BATCH_SIZE = 10;
    private const int MAX_QUEUE_SIZE = 100;

    private Queue<CrashReport> reportQueue = new Queue<CrashReport>();
    private string playerId;
    private string sessionId;
    private string buildId;

    public static CrashReporter Instance { get; private set; }

    void Awake()
    {
        if (Instance != null)
        {
            Destroy(gameObject);
            return;
        }
        Instance = this;
        DontDestroyOnLoad(gameObject);

        Initialize();
    }

    private void Initialize()
    {
        playerId = PlayerPrefs.GetString("PlayerId", Guid.NewGuid().ToString());
        PlayerPrefs.SetString("PlayerId", playerId);

        sessionId = Guid.NewGuid().ToString();
        buildId = Application.version;

        // Set up crash handlers
        Application.logMessageReceived += OnLogMessage;
        AppDomain.CurrentDomain.UnhandledException += OnUnhandledException;

        Debug.Log($"CrashReporter initialized. Session: {sessionId}");
    }

    private void OnLogMessage(string condition, string stack, LogType type)
    {
        if (type == LogType.Exception || type == LogType.Error)
        {
            var report = new CrashReport
            {
                Type = type.ToString(),
                Message = condition,
                StackTrace = stack,
                Timestamp = DateTime.UtcNow,
                PlayerId = playerId,
                SessionId = sessionId,
                BuildId = buildId,
                DeviceInfo = GetDeviceInfo(),
                UnityVersion = Application.unityVersion
            };

            EnqueueReport(report);
        }
    }

    private void OnUnhandledException(object sender, UnhandledExceptionEventArgs e)
    {
        var exception = e.ExceptionObject as Exception;
        var report = new CrashReport
        {
            Type = "UnhandledException",
            Message = exception?.Message ?? "Unknown exception",
            StackTrace = exception?.StackTrace ?? "",
            Timestamp = DateTime.UtcNow,
            PlayerId = playerId,
            SessionId = sessionId,
            BuildId = buildId,
            DeviceInfo = GetDeviceInfo(),
            UnityVersion = Application.unityVersion,
            IsTerminating = e.IsTerminating
        };

        EnqueueReport(report);
        FlushReports(); // Immediate send for unhandled exceptions
    }

    private void EnqueueReport(CrashReport report)
    {
        reportQueue.Enqueue(report);

        // Prevent queue overflow
        while (reportQueue.Count > MAX_QUEUE_SIZE)
        {
            reportQueue.Dequeue();
        }

        if (reportQueue.Count >= BATCH_SIZE)
        {
            FlushReports();
        }
    }

    private async void FlushReports()
    {
        if (reportQueue.Count == 0) return;

        var reports = new List<CrashReport>();
        while (reportQueue.Count > 0 && reports.Count < BATCH_SIZE)
        {
            reports.Add(reportQueue.Dequeue());
        }

        try
        {
            await SendReports(reports);
        }
        catch (Exception ex)
        {
            Debug.LogError($"Failed to send crash reports: {ex.Message}");
            // Re-queue failed reports
            foreach (var report in reports)
            {
                reportQueue.Enqueue(report);
            }
        }
    }

    private async Awaitable SendReports(List<CrashReport> reports)
    {
        var json = JsonUtility.ToJson(new CrashReportBatch { Reports = reports });
        var bytes = System.Text.Encoding.UTF8.GetBytes(json);

        using var request = UnityWebRequest.Post(CRASH_ENDPOINT, "POST");
        request.uploadHandler = new UploadHandlerRaw(bytes);
        request.SetRequestHeader("Content-Type", "application/json");

        await request.SendWebRequest();

        if (request.result != UnityWebRequest.Result.Success)
        {
            throw new Exception(request.error);
        }
    }

    private string GetDeviceInfo()
    {
        return $"OS: {SystemInfo.operatingSystem}, " +
               $"CPU: {SystemInfo.processorType}, " +
               $"GPU: {SystemInfo.graphicsDeviceName}, " +
               $"RAM: {SystemInfo.systemMemorySize}MB, " +
               $"Screen: {Screen.width}x{Screen.height}";
    }

    void OnDestroy()
    {
        Application.logMessageReceived -= OnLogMessage;
        FlushReports(); // Send any remaining reports
    }
}

[Serializable]
public class CrashReport
{
    public string Type;
    public string Message;
    public string StackTrace;
    public DateTime Timestamp;
    public string PlayerId;
    public string SessionId;
    public string BuildId;
    public string DeviceInfo;
    public string UnityVersion;
    public bool IsTerminating;
}

[Serializable]
public class CrashReportBatch
{
    public List<CrashReport> Reports;
}
```

### Step 5.2: Hotfix System

```csharp
// Hotfix/HotfixManager.cs
using UnityEngine;
using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Threading.Tasks;

public class HotfixManager : MonoBehaviour
{
    private const string HOTFIX_URL = "https://api.example.com/hotfix";
    private const string HOTFIX_VERSION_ENDPOINT = "/manifest.json";

    [SerializeField] private bool autoCheckOnStart = true;
    [SerializeField] private float checkIntervalHours = 1f;

    private HotfixManifest currentManifest;
    private DateTime lastCheckTime;

    public static HotfixManager Instance { get; private set; }

    void Awake()
    {
        if (Instance != null)
        {
            Destroy(gameObject);
            return;
        }
        Instance = this;
    }

    async void Start()
    {
        if (autoCheckOnStart)
        {
            await CheckForHotfix();
        }

        // Periodic checks
        InvokeRepeating(nameof(PeriodicCheck), checkIntervalHours * 3600, checkIntervalHours * 3600);
    }

    private async void PeriodicCheck()
    {
        await CheckForHotfix();
    }

    public async Task CheckForHotfix()
    {
        try
        {
            var manifestUrl = $"{HOTFIX_URL}{HOTFIX_VERSION_ENDPOINT}?v={Application.version}";
            var response = await GetAsync<HotfixManifest>(manifestUrl);

            if (response != null && response.version > GetCurrentHotfixVersion())
            {
                Debug.Log($"Hotfix available: {response.version}");
                await PromptAndApplyHotfix(response);
            }
        }
        catch (Exception ex)
        {
            Debug.LogWarning($"Hotfix check failed: {ex.Message}");
        }
    }

    private async Task PromptAndApplyHotfix(HotfixManifest manifest)
    {
        // Show UI prompt to user
        // For now, auto-apply
        await ApplyHotfix(manifest);
    }

    private async Task ApplyHotfix(HotfixManifest manifest)
    {
        Debug.Log($"Applying hotfix version {manifest.version}...");

        foreach (var file in manifest.files)
        {
            try
            {
                var data = await DownloadAsync(file.url);

                // Verify hash
                var hash = ComputeHash(data);
                if (hash != file.hash)
                {
                    throw new Exception($"Hash mismatch for {file.path}");
                }

                // Apply patch
                await ApplyPatch(file.path, data);
            }
            catch (Exception ex)
            {
                Debug.LogError($"Failed to apply hotfix for {file.path}: {ex.Message}");
                return;
            }
        }

        // Update local manifest
        SaveManifest(manifest);
        currentManifest = manifest;

        Debug.Log("Hotfix applied successfully. Restart to apply changes.");
        ShowRestartPrompt();
    }

    private async Task<byte[]> DownloadAsync(string url)
    {
        using var request = UnityWebRequest.Get(url);
        await request.SendWebRequest();

        if (request.result != UnityWebRequest.Result.Success)
        {
            throw new Exception($"Download failed: {request.error}");
        }

        return request.downloadHandler.data;
    }

    private Task ApplyPatch(string path, byte[] data)
    {
        var fullPath = Path.Combine(Application.persistentDataPath, path);
        var directory = Path.GetDirectoryName(fullPath);

        if (!string.IsNullOrEmpty(directory))
        {
            Directory.CreateDirectory(directory);
        }

        return File.WriteAllBytesAsync(fullPath, data);
    }

    private string ComputeHash(byte[] data)
    {
        using var sha256 = SHA256.Create();
        var hash = sha256.ComputeHash(data);
        return BitConverter.ToString(hash).Replace("-", "").ToLowerInvariant();
    }

    private Version GetCurrentHotfixVersion()
    {
        return currentManifest?.version ?? new Version(0, 0, 0);
    }

    private void SaveManifest(HotfixManifest manifest)
    {
        var path = Path.Combine(Application.persistentDataPath, "hotfix_manifest.json");
        var json = JsonUtility.ToJson(manifest);
        File.WriteAllText(path, json);
    }
}

[Serializable]
public class HotfixManifest
{
    public Version version;
    public List<HotfixFile> files;
    public DateTime releasedAt;
    public string description;
}

[Serializable]
public class HotfixFile
{
    public string path;
    public string url;
    public string hash;
    public long size;
}
```

## Common Mistakes

| # | Mistake | Why It Fails | What to Do Instead |
|---|---------|---------------|-------------------|
| 1 | Building on developer machines | Inconsistent builds | Use CI/CD with containerized builds |
| 2 | Manual signing steps | Human error, delays | Automate with secret management |
| 3 | No artifact caching | Slow builds | Cache dependencies, assets |
| 4 | Single build machine | Bottleneck, SPOF | Distributed builds, multiple agents |
| 5 | No incremental compilation | Slow iteration | Implement change detection |
| 6 | Committing secrets | Security breach | Use secret vaults |
| 7 | No build verification | Release bad builds | Automated tests in pipeline |
| 8 | Ignoring build times | Developer frustration | Profile and optimize |
| 9 | No hotfix capability | Slow response to issues | Implement hotfix pipeline |
| 10 | Ignoring build size | App store rejections | Monitor and optimize bundle size |

## Handoff Protocol

| To | Provide | Format |
|----|---------|--------|
| DevOps | Pipeline configuration, infrastructure needs | Documentation |
| QA | Test environment access, automated tests | Access credentials |
| Platform Relations | Build artifacts, store assets | Required files |
| Community | Release notes, patch notes | Generated content |
| Security | Signing certificates, access logs | Audit trail |

## Execution Checklist

### CI/CD Foundation
- [ ] Canonical local build/test/security pipeline configured
- [ ] Hosted-provider adapter configured only if explicitly required
- [ ] Build caching configured (dependencies, assets)
- [ ] Windows build working
- [ ] macOS build working
- [ ] Linux build working
- [ ] Docker containers for builds defined

### Platform Builds
- [ ] iOS build and signing automated
- [ ] Android build and signing automated
- [ ] Steam build pipeline working
- [ ] Epic build pipeline working
- [ ] WebGL build pipeline working

### Asset Pipeline
- [ ] Texture optimization configured
- [ ] Audio compression configured
- [ ] Shader precompilation working
- [ ] Asset dependency tracking configured

### Release Automation
- [ ] Release notes generator built
- [ ] Pre-release checklist automated
- [ ] Platform upload scripts created
- [ ] Version tagging automated

### Monitoring & Operations
- [ ] Crash reporter integrated
- [ ] Hotfix system implemented
- [ ] Build metrics tracking
- [ ] Performance baselines defined

### Quality Gates
- [ ] Automated tests in pipeline
- [ ] Build times under target threshold
- [ ] Bundle size monitoring
- [ ] All platforms building from CI

### Documentation
- [ ] Build setup documentation
- [ ] Platform guide documentation
- [ ] Hotfix procedures documented
- [ ] Emergency procedures documented
