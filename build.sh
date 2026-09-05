#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

# ==============================================================================
# oh-my-pi Mobile: CI-Less Standalone Build Script
#
# Builds a standalone Android APK completely on-device without remote CI.
# Uses: aapt2, javac, d8, apksigner, bun
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== [1/6] Preparing Build Environment ==="
mkdir -p build/gen build/obj build/dex build/outputs sdk
export PATH="$PREFIX/bin:$PATH"

ANDROID_JAR="$SCRIPT_DIR/sdk/android.jar"
if [ ! -f "$ANDROID_JAR" ]; then
  echo "Error: sdk/android.jar not found! Please ensure android.jar is downloaded."
  exit 1
fi

KEYSTORE="$SCRIPT_DIR/sdk/debug.keystore"
if [ ! -f "$KEYSTORE" ]; then
  echo "Generating debug signing keystore..."
  keytool -genkeypair -v -keystore "$KEYSTORE" \
    -storepass android -alias androiddebugkey -keypass android \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=OhMyPi,O=OhMyPiMobile,C=US"
fi

echo "=== [2/6] Bundling Core Module ==="
bun build core/index.ts --outdir app/assets/js --target browser --minify

echo "=== [3/6] Compiling Android Resources (aapt2 compile) ==="
rm -rf build/res.zip build/gen/* build/obj/* build/dex/*
aapt2 compile --dir app/res -o build/res.zip

echo "=== [4/6] Linking APK & Generating R.java (aapt2 link) ==="
aapt2 link -I "$ANDROID_JAR" \
  --manifest app/AndroidManifest.xml \
  -o build/app-unaligned.apk \
  --java build/gen \
  -A app/assets \
  build/res.zip \
  --auto-add-overlay

echo "=== [5/6] Compiling Java Sources & Building DEX ==="
javac -cp "$ANDROID_JAR" -d build/obj \
  build/gen/com/oh_my_pi/mobile/R.java \
  app/src/com/oh_my_pi/mobile/*.java

d8 --output build/dex --lib "$ANDROID_JAR" \
  $(find build/obj -name "*.class")

(cd build/dex && zip -u ../app-unaligned.apk classes.dex)

echo "=== [6/6] Signing APK (apksigner) ==="
apksigner sign --ks "$KEYSTORE" \
  --ks-pass pass:android \
  --key-pass pass:android \
  --out build/outputs/oh-my-pi-mobile.apk \
  build/app-unaligned.apk

apksigner verify build/outputs/oh-my-pi-mobile.apk

echo "=== Build Complete! ==="
ls -lh build/outputs/oh-my-pi-mobile.apk
