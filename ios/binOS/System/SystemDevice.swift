import Foundation

// 需要单独处理的设备，按型号标识认出来；其余设备走通用规则
enum SystemDevice {
    case duo
    case other

    static let current: SystemDevice = modelIdentifier == "iPhone19,4" ? .duo : .other

    // 真机从 uname 读取；模拟器上 uname 是 CPU 架构，型号在 SIMULATOR_MODEL_IDENTIFIER 里
    static let modelIdentifier: String = {
        if let simulated = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] { return simulated }
        var info = utsname()
        uname(&info)
        return withUnsafeBytes(of: info.machine) { String(decoding: $0.prefix { $0 != 0 }, as: UTF8.self) }
    }()
}
