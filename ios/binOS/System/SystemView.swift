import SwiftUI

struct MonitorStatus: Decodable {
    struct Volume: Decodable, Hashable {
        @Default<Defaults.Empty> var filesystem: String
        let mount: String
        @Default<Defaults.Zero> var total: Double
        @Default<Defaults.Zero> var available: Double
        @Default<Defaults.Zero> var used: Double
    }

    struct Snapshot: Decodable {
        struct Host: Decodable {
            @Default<Defaults.Empty> var name: String
            @Default<Defaults.Empty> var model: String
            @Default<Defaults.Empty> var chip: String
            @Default<Defaults.Empty> var os: String
            @Default<Defaults.Zero> var uptime: Double
            @Default<Defaults.ZeroInt> var cores: Int
        }

        struct CPU: Decodable { let percent: Double? }

        struct Memory: Decodable {
            @Default<Defaults.Zero> var total: Double
            @Default<Defaults.Zero> var free: Double
            let cached: Double?
            @Default<Defaults.Empty> var pressure: String
        }

        struct Network: Decodable {
            let receiveRate: Double?
            let sendRate: Double?
        }

        struct Power: Decodable {
            @Default<Defaults.Empty> var source: String
            let battery: Double?
        }

        struct Runtime: Decodable {
            @Default<Defaults.Empty> var version: String
            @Default<Defaults.Zero> var uptime: Double
            @Default<Defaults.Zero> var memory: Double
            @Default<Defaults.False> var test: Bool
        }

        @Default<Defaults.Zero> var at: Double
        let host: Host
        let cpu: CPU
        let memory: Memory
        @Lossy var volumes: [Volume]
        let network: Network
        let power: Power
        let runtime: Runtime
        @Lossy var unavailable: [String]
    }

    let snapshot: Snapshot?
    @Default<Defaults.False> var collecting: Bool
    let collectionError: String?
}

// 系统：宿主 Mac 的状态，服务端每采样一次推送一次
struct SystemView: View {
    @State private var status: MonitorStatus?
    @State private var error: String?
    @State private var refreshing = false
    @State private var stream: EventStream?
    private let hub = EventHub.shared

    var body: some View {
        List {
            if let snapshot = status?.snapshot {
                Section {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(snapshot.host.name).font(.title2.bold())
                        Text("\(snapshot.host.chip) · \(snapshot.host.cores) 核 · \(snapshot.host.os)")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 4)
                    if !snapshot.unavailable.isEmpty {
                        Label("读不到：\(snapshot.unavailable.joined(separator: "、"))", systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.orange)
                            .font(.footnote)
                    }
                } footer: {
                    Text(freshness(snapshot))
                }
                Section("运行状况") {
                    MeterRow(title: "CPU", icon: "cpu", value: (snapshot.cpu.percent ?? 0) / 100, text: snapshot.cpu.percent.map { "\(Int($0))%" } ?? "采样中")
                    let memory = snapshot.memory
                    if let cached = memory.cached {
                        let used = max(0, memory.total - memory.free - cached)
                        MeterRow(title: "内存", icon: "memorychip", value: used / max(memory.total, 1), text: "\(Format.bytes(used)) / \(Format.bytes(memory.total))")
                            .tint(memory.pressure == "critical" ? .red : memory.pressure == "warning" ? .orange : .accentColor)
                    }
                    LabeledContent("内存压力", value: ["normal": "正常", "warning": "偏高", "critical": "很高"][memory.pressure] ?? "未知")
                    LabeledContent("网络") {
                        Text("↓ \(snapshot.network.receiveRate.map { Format.bytes($0) + "/s" } ?? "—")  ↑ \(snapshot.network.sendRate.map { Format.bytes($0) + "/s" } ?? "—")")
                            .monospacedDigit()
                    }
                    LabeledContent("电源") {
                        let source = snapshot.power.source == "AC Power" ? "外接电源" : snapshot.power.source == "Battery Power" ? "电池供电" : snapshot.power.source
                        Text(snapshot.power.battery.map { "\(source) · \(Int($0))%" } ?? source)
                    }
                    LabeledContent("已开机", value: uptime(snapshot.host.uptime))
                }
                Section("存储") {
                    ForEach(snapshot.volumes, id: \.mount) { volume in
                        VStack(alignment: .leading, spacing: 6) {
                            HStack {
                                Text(volume.mount == "/" || volume.mount == "/System/Volumes/Data" ? "启动磁盘" : (volume.mount as NSString).lastPathComponent)
                                Spacer()
                                Text("可用 \(Format.bytes(volume.available)) / \(Format.bytes(volume.total))")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            ProgressView(value: (volume.total - volume.available) / max(volume.total, 1))
                        }
                    }
                }
                Section("binOS") {
                    LabeledContent("连接", value: hub.connected ? "已连接" : "连接已断开")
                    LabeledContent("版本", value: String(snapshot.runtime.version.prefix(7)))
                    LabeledContent("环境", value: snapshot.runtime.test ? "测试 / 预览" : "正式版")
                    LabeledContent("已运行", value: uptime(snapshot.runtime.uptime))
                    LabeledContent("内存", value: Format.bytes(snapshot.runtime.memory))
                }
            } else if let error {
                Text(error).foregroundStyle(.red)
            } else {
                HStack { Spacer(); ProgressView("首次采集中"); Spacer() }
            }
        }
        .navigationTitle("系统")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("刷新", systemImage: "arrow.clockwise") {
                    Task {
                        refreshing = true
                        do {
                            status = try await API.shared.send("POST", "/api/apps/system/refresh")
                        } catch {
                            self.error = error.localizedDescription
                        }
                        refreshing = false
                    }
                }
                .disabled(refreshing)
            }
        }
        .onAppear {
            guard stream == nil else { return }
            let next = EventStream(
                url: { API.shared.url("/api/apps/system/stream") },
                onMessage: { message in
                    guard let value = try? JSONDecoder.api.decode(MonitorStatus.self, from: Data(message.data.utf8)) else { return }
                    status = value
                    error = nil
                },
                onConnectedChange: { connected in
                    if !connected { error = "监控连接中断" }
                }
            )
            stream = next
            next.start()
        }
        .onDisappear {
            stream?.stop()
            stream = nil
        }
    }

    private func freshness(_ snapshot: MonitorStatus.Snapshot) -> String {
        let at = Date(timeIntervalSince1970: snapshot.at / 1000)
        let state = error != nil ? "监控连接异常" : Date.now.timeIntervalSince(at) > 30 ? "数据已过期" : status?.collectionError != nil ? "采集异常" : "正在监控"
        return "\(state) · \(at.formatted(date: .omitted, time: .standard))"
    }

    private func uptime(_ seconds: Double) -> String {
        let total = Int(seconds)
        let days = total / 86400, hours = total % 86400 / 3600, minutes = total % 3600 / 60
        return days > 0 ? "\(days) 天 \(hours) 小时" : hours > 0 ? "\(hours) 小时 \(minutes) 分" : "\(minutes) 分"
    }
}

private struct MeterRow: View {
    let title: String
    let icon: String
    let value: Double
    let text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            LabeledContent {
                Text(text).monospacedDigit()
            } label: {
                Label(title, systemImage: icon)
            }
            ProgressView(value: min(max(value, 0), 1))
        }
    }
}
