#!/bin/bash
set -euo pipefail
platform=${1:?需要构建目标}
output=${BINOS_BUILD_OUTPUT:?需要产物目录}
number=${BINOS_BUILD_NUMBER:?需要构建号}
case "$platform" in
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
