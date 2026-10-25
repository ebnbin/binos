#!/bin/bash
set -euo pipefail
platform=${1:?需要构建目标}
output=${BINOS_BUILD_OUTPUT:?需要产物目录}
number=${BINOS_BUILD_NUMBER:?需要构建号}
case "$platform" in
  android)
    export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
    export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home}"
    export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"
    # 构建机使用已安装的 JDK；不依赖生成时记录的外部 JDK 下载地址。
    rm -f android/gradle/gradle-daemon-jvm.properties
    printf 'sdk.dir=%s\n' "$ANDROID_HOME" > android/local.properties
    (cd android && bash ./gradlew --no-daemon -PciBuildNumber="$number" assembleDebug testDebugUnitTest lintDebug)
    cp android/app/build/outputs/apk/debug/app-debug.apk "$output/binos-android-debug.apk"
    ;;
  ios)
    if ! security find-identity -v -p codesigning | grep -Eq '[1-9][0-9]* valid identities found'; then
      echo '没有可用签名证书。请在 Xcode 配置开发者账号、证书及 Ad Hoc 设备。' >&2
      exit 1
    fi
    xcodebuild -project ios/binOS.xcodeproj -scheme binOS -configuration Release -destination 'generic/platform=iOS' -archivePath .mobile-build/binOS.xcarchive -derivedDataPath .mobile-build/device CURRENT_PROJECT_VERSION="$number" -allowProvisioningUpdates archive
    xcodebuild -exportArchive -archivePath .mobile-build/binOS.xcarchive -exportOptionsPlist ios/ExportOptions-AdHoc.plist -exportPath .mobile-build/adhoc -allowProvisioningUpdates
    cp .mobile-build/adhoc/binOS.ipa "$output/binos-ios-adhoc.ipa"
    ;;
  *) echo "未知目标：$platform" >&2; exit 1 ;;
esac
