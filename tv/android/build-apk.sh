#!/bin/bash
# Build ProDeck Display (the Fire TV / Android TV app) into
# tv/android/ProDeckDisplay.apk, which scripts/release-public.sh attaches to
# every release and booths serve from /tv.apk.
#
# Needs JDK 17 and the Android SDK (platform 35, build-tools 35):
#   brew install openjdk@17 gradle && brew install --cask android-commandlinetools
#   sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0"
#
# Signed with this Mac's debug key. Keep building on the same Mac (or copy
# ~/.android/debug.keystore): a TV only accepts an update signed the same way.
set -euo pipefail
cd "$(dirname "$0")"
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
echo "sdk.dir=$ANDROID_HOME" > local.properties
./gradlew -q assembleRelease
cp app/build/outputs/apk/release/app-release.apk ProDeckDisplay.apk
echo "✓ $(pwd)/ProDeckDisplay.apk ($(du -h ProDeckDisplay.apk | cut -f1))"
