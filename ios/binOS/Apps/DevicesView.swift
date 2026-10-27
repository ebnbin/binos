import SwiftUI

struct DevicesSnapshot: Decodable {
    struct Device: Decodable, Hashable, Identifiable {
        let id: String
        @Default<Defaults.Empty> var platform: String
        @Default<Defaults.Empty> var name: String
        @Default<Defaults.Empty> var target: String
        let system: String?
        @Default<Defaults.Empty> var status: String
        let error: String?
    }

    struct Lease: Decodable, Hashable, Identifiable {
        @Default<Defaults.Empty> var requestId: String
        let claimed: Bool?
        let id: String
        @Default<Defaults.Empty> var owner: String
        @Default<Defaults.Empty> var reason: String
        @Lossy var platforms: [String]
        @Lossy var devices: [String]
        @Default<Defaults.Zero> var createdAt: Double
    }

    struct Waiting: Decodable, Hashable, Identifiable {
        let id: String
        @Default<Defaults.Empty> var owner: String
        @Default<Defaults.Empty> var reason: String
        @Lossy var platforms: [String]
        @Default<Defaults.Empty> var phase: String
        let error: String?
    }

    struct Event: Decodable, Hashable {
        @Default<Defaults.Zero> var time: Double
        @Default<Defaults.Empty> var text: String
    }

    // 系统里已有的模拟器，只读展示，不参与分配
    struct Observed: Decodable, Hashable {
        @Default<Defaults.Empty> var platform: String
        @Default<Defaults.Empty> var name: String
        @Default<Defaults.Empty> var target: String
        @Default<Defaults.Empty> var state: String
    }

    struct Owner: Decodable, Hashable {
        let session: Int
        @Default<Defaults.Empty> var title: String
    }

    @Lossy var devices: [Device]
    @Lossy var leases: [Lease]
    @Lossy var queue: [Waiting]
    @Lossy var events: [Event]
    @Default<Defaults.ZeroInt> var capacity: Int
    @Default<Defaults.Empty> var mode: String
    @Default<Defaults.Zero> var startedAt: Double
    @Lossy var observed: [Observed]
    @Lossy var discoveryErrors: [String]
    @LossyDictionary var owners: [String: Owner]
}

// 设备：开发验证用的模拟器池，可以手动申请、归还、看截图
struct DevicesView: View {
    @State private var snapshot: DevicesSnapshot?
    @State private var error: String?
    @State private var platform = "both"
    @State private var reason = "手动验证"
    // 手动申请的编号：排队时每 30 秒重新申请一次保活
    @AppStorage("devices/request") private var requestId = ""
    @State private var screenshot: (id: String, image: UIImage, at: Date?)?
    @State private var busy = false
    @State private var destroying: (device: DevicesSnapshot.Device, leased: Bool)?
    private let hub = EventHub.shared

    private var manualLease: DevicesSnapshot.Lease? { snapshot?.leases.first { $0.owner == "manual" } }
    private var manualWaiting: DevicesSnapshot.Waiting? { snapshot?.queue.first { $0.owner == "manual" && $0.id == requestId } }

    var body: some View {
        List {
            if let snapshot {
                Section {
                    LabeledContent("设备池", value: "\(snapshot.devices.count) / \(snapshot.capacity)")
                    LabeledContent("闲置", value: "\(snapshot.devices.count { $0.status == "free" })")
                    LabeledContent("租约", value: "\(snapshot.leases.count)")
                } footer: {
                    if snapshot.mode == "mock" { Text("模拟设备预览 · 所有操作与正式设备隔离") }
                }
                Section("手动申请") {
                    if let lease = manualLease {
                        Text("正在使用：\(lease.devices.joined(separator: "、"))").font(.footnote)
                        Button("归还我的设备", role: .destructive) { Task { await call("DELETE", "/leases/\(lease.id)") } }
                    } else if let waiting = manualWaiting {
                        Text(waiting.phase == "failed" ? (waiting.error ?? "申请失败") : "排队中").font(.footnote)
                        Button("取消申请", role: .destructive) {
                            Task { await call("DELETE", "/queue/\(requestId)") }
                        }
                    } else {
                        Picker("平台", selection: $platform) {
                            Text("Android + iOS").tag("both")
                            Text("Android").tag("android")
                            Text("iOS").tag("ios")
                        }
                        TextField("用途", text: $reason)
                        Button("申请设备") {
                            requestId = UUID().uuidString
                            Task { await acquire() }
                        }
                    }
                }
                devicesSection(snapshot)
                queueSection(snapshot)
                observedSection(snapshot)
                eventsSection(snapshot)
            }
            if let error { Text(error).foregroundStyle(.red) }
        }
        .overlay { if snapshot == nil && error == nil { ProgressView() } }
        .navigationTitle("设备")
        .toolbar {
            Button("刷新设备", systemImage: "arrow.clockwise") { Task { await run { try await fetch() } } }
                .disabled(busy)
        }
        .confirmationDialog(
            destroying?.leased == true ? "强制回收 \(destroying?.device.name ?? "")" : "销毁 \(destroying?.device.name ?? "")",
            isPresented: Binding(get: { destroying != nil }, set: { if !$0 { destroying = nil } }),
            titleVisibility: .visible,
            presenting: destroying
        ) { target in
            Button(target.leased ? "确认中断租约并销毁" : "确认销毁设备", role: .destructive) {
                Task { await call("DELETE", "/\(target.device.id)") }
            }
        }
        .sheet(isPresented: Binding(get: { screenshot != nil }, set: { if !$0 { screenshot = nil } })) {
            if let screenshot {
                VStack {
                    Image(uiImage: screenshot.image).resizable().scaledToFit()
                    if let at = screenshot.at {
                        Text("截图于 \(at.formatted(date: .omitted, time: .standard)) · 非实时画面").font(.caption).foregroundStyle(.secondary)
                    }
                }
                .padding()
                .presentationDetents([.large])
            }
        }
        // 设备、租约、排队和操作记录变了时有 devices 通知
        .task(id: hub.devices) { await load() }
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(30))
                if manualWaiting != nil || (manualLease != nil && manualLease?.claimed != true) { await acquire() }
            }
        }
    }

    private func devicesSection(_ snapshot: DevicesSnapshot) -> some View {
        Section("设备") {
            ForEach(snapshot.devices) { device in
                let leased = snapshot.leases.contains { $0.devices.contains(device.id) }
                DeviceRow(device: device, lease: snapshot.leases.first { $0.devices.contains(device.id) }, owners: snapshot.owners) {
                    Task { await capture(device.id) }
                }
                .swipeActions { destroyButton(device, leased: leased) }
                .contextMenu { destroyButton(device, leased: leased) }
            }
        }
    }

    @ViewBuilder
    private func destroyButton(_ device: DevicesSnapshot.Device, leased: Bool) -> some View {
        if device.status != "destroying" {
            Button(leased ? "强制回收" : "销毁设备", systemImage: "trash", role: .destructive) {
                destroying = (device, leased)
            }
        }
    }

    @ViewBuilder
    private func queueSection(_ snapshot: DevicesSnapshot) -> some View {
        if !snapshot.queue.isEmpty {
            Section("排队") {
                ForEach(snapshot.queue) { item in
                    let phase = item.phase == "preparing" ? "正在准备整组设备" : item.phase == "failed" ? item.error ?? "" : "等待容量"
                    VStack(alignment: .leading) {
                        Text(item.reason)
                        Text("\(item.platforms.joined(separator: " + ")) · \(phase)").font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
        }
    }

    private func observedSection(_ snapshot: DevicesSnapshot) -> some View {
        Section {
            ForEach(snapshot.observed, id: \.self) { item in
                LabeledContent(item.name, value: "\(item.platform) · \(item.state)")
            }
            Button("只读发现", systemImage: "magnifyingglass") {
                Task { await run { self.snapshot = try await API.shared.send("POST", "/api/apps/devices/discover") } }
            }
            .disabled(busy)
            ForEach(snapshot.discoveryErrors, id: \.self) { text in
                Text(text).font(.footnote).foregroundStyle(.red)
            }
        } header: {
            Text("已有模拟器")
        } footer: {
            Text("这些设备不参与分配，也不会被清理或接管。")
        }
    }

    private func eventsSection(_ snapshot: DevicesSnapshot) -> some View {
        Section {
            ForEach(Array(snapshot.events.suffix(30).reversed().enumerated()), id: \.offset) { _, event in
                VStack(alignment: .leading, spacing: 2) {
                    Text(event.text).font(.footnote)
                    Text(Date(timeIntervalSince1970: event.time / 1000), format: .dateTime.hour().minute().second()).font(.caption2).foregroundStyle(.secondary)
                }
            }
        } header: {
            Text("最近的操作")
        } footer: {
            Text("独立设备管理服务 · 启动于 \(Date(timeIntervalSince1970: snapshot.startedAt / 1000), format: .dateTime.hour().minute())")
        }
    }

    private func fetch() async throws {
        snapshot = try await API.shared.get("/api/apps/devices")
    }

    private func load() async {
        do {
            try await fetch()
            error = nil
        } catch is CancellationError {
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func run(_ operation: () async throws -> Void) async {
        busy = true
        defer { busy = false }
        do {
            try await operation()
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func acquire() async {
        struct Body: Encodable {
            let platforms: [String]
            let reason: String
            let requestId: String
        }
        let platforms = platform == "both" ? ["android", "ios"] : [platform]
        await call("POST", "/leases", body: Body(platforms: platforms, reason: reason, requestId: requestId))
    }

    private func call(_ method: String, _ path: String, body: (any Encodable)? = nil) async {
        do {
            let _: Ignored = try await API.shared.send(method, "/api/apps/devices\(path)", body: body)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
        await load()
    }

    // 响应体就是截图，Last-Modified 是截图的时间
    private func capture(_ id: String) async {
        let api = API.shared
        do {
            let (data, response) = try await api.session.data(for: api.request(api.url("/api/apps/devices/\(id)/screenshot")))
            let http = try api.check(response, data: data)
            guard let image = UIImage(data: data) else { throw APIError.invalidResponse }
            let at = http.value(forHTTPHeaderField: "Last-Modified").flatMap { Self.httpDate.date(from: $0) }
            screenshot = (id, image, at)
        } catch {
            self.error = error.localizedDescription
        }
    }
}

extension DevicesView {
    fileprivate static let httpDate: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "GMT")
        formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss zzz"
        return formatter
    }()
}

private struct DeviceRow: View {
    let device: DevicesSnapshot.Device
    let lease: DevicesSnapshot.Lease?
    let owners: [String: DevicesSnapshot.Owner]
    let onScreenshot: () -> Void

    private static let statusNames = ["creating": "初始化中", "checking": "检查中", "free": "闲置", "reserved": "整组预留", "leased": "使用中", "cleaning": "清理中", "destroying": "回收中", "broken": "故障隔离"]

    var body: some View {
        HStack {
            Image(systemName: device.platform == "ios" ? "iphone" : "candybarphone")
                .foregroundStyle(device.status == "free" ? .green : device.status == "broken" ? .red : .orange)
            VStack(alignment: .leading, spacing: 2) {
                Text(device.name)
                Text([Self.statusNames[device.status] ?? device.status, device.system].compactMap { $0 }.joined(separator: " · "))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                if let lease {
                    Text(lease.owner == "manual" ? "手动使用" : owners[lease.owner].map { "对话：\($0.title)" } ?? lease.reason)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                if let error = device.error { Text(error).font(.caption).foregroundStyle(.red) }
            }
            Spacer()
            if ["free", "reserved", "leased"].contains(device.status), device.error == nil {
                Button("截图", systemImage: "camera", action: onScreenshot).labelStyle(.iconOnly).buttonStyle(.borderless)
            }
        }
    }
}
