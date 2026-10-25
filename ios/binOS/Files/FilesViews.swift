import PhotosUI
import SwiftUI

struct FileEntry: Decodable, Hashable, Identifiable {
    @Default<Defaults.Empty> var name: String
    let path: String
    @Default<Defaults.False> var directory: Bool
    @Default<Defaults.False> var symlink: Bool
    @Default<Defaults.Zero> var size: Double
    @Default<Defaults.Zero> var modified: Double
    var id: String { path }
}

struct FileListing: Decodable {
    let path: String
    @Default<Defaults.Empty> var parent: String
    @Default<Defaults.Empty> var home: String
    @Lossy var entries: [FileEntry]
}

enum FilesAPI {
    static let base = "/api/apps/files"

    static func list(_ path: String?) async throws -> FileListing {
        try await API.shared.get(base, query: path.map { ["path": $0] } ?? [:])
    }

    static func downloadURL(_ path: String) -> URL {
        API.shared.url("\(base)/download", query: ["path": path])
    }

    // 在 path 目录里新建 name，或者把 path 改名为 name
    private struct Name: Encodable {
        let path: String
        let name: String
    }

    static func createDirectory(in path: String, name: String) async throws {
        try await API.shared.post("\(base)/directories", body: Name(path: path, name: name))
    }

    static func rename(_ path: String, to name: String) async throws {
        try await API.shared.post("\(base)/rename", body: Name(path: path, name: name))
    }

    // 批量操作逐项返回结果，顺序和请求里的一样
    private struct Results: Decodable {
        struct Result: Decodable {
            struct Failure: Decodable { let message: String }
            let path: String
            let error: Failure?
        }
        let results: [Result]
    }

    struct PartialFailure: LocalizedError {
        let errorDescription: String?
    }

    enum Batch {
        case copy(paths: [String], destination: String)
        case move(paths: [String], destination: String)
        case trash(paths: [String])
    }

    private struct Transfer: Encodable {
        let paths: [String]
        var destination: String?
    }

    // 有没做成的项时报出个数和第一个的原因，其余的照样做完
    static func run(_ batch: Batch) async throws {
        let (route, body): (String, Transfer) = switch batch {
        case .copy(let paths, let destination): ("copy", Transfer(paths: paths, destination: destination))
        case .move(let paths, let destination): ("move", Transfer(paths: paths, destination: destination))
        case .trash(let paths): ("trash", Transfer(paths: paths))
        }
        let response: Results = try await API.shared.send("POST", "\(base)/\(route)", body: body)
        let failed = response.results.compactMap(\.error)
        if let first = failed.first {
            throw PartialFailure(errorDescription: "\(failed.count) 项没有完成：\(first.message)")
        }
    }

    static func upload(directory: String, name: String, data: Data) async throws {
        var components = URLComponents(url: API.shared.url("\(base)/upload"), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "path", value: directory), URLQueryItem(name: "name", value: name)]
        var request = API.shared.request(components.url!, method: "POST")
        request.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
        let (body, response) = try await API.shared.session.upload(for: request, from: data)
        _ = try API.shared.check(response, data: body)
    }
}

// 文件：宿主 Mac 上的文件，浏览、预览、上传、整理
struct FilesRootView: View {
    @State private var path: [String] = []
    @State private var home: String?
    // 剪切或复制的文件，到别的文件夹里粘贴
    @State private var clipboard: (paths: [String], move: Bool)?
    @Bindable private var router = AppRouter.shared

    var body: some View {
        NavigationStack(path: $path) {
            FolderView(path: nil, home: $home, navigate: navigate, clipboard: $clipboard.animation())
                .navigationDestination(for: String.self) { folder in
                    FolderView(path: folder, home: $home, navigate: navigate, clipboard: $clipboard.animation())
                }
        }
        .onChange(of: router.files, initial: true) { _, target in
            if let target {
                router.files = nil
                navigate(target)
            }
        }
    }

    // 从位置菜单或路径跳转：替换整个导航栈
    private func navigate(_ target: String) {
        path = target == home ? [] : [target]
    }
}

private struct FolderView: View {
    let path: String?
    @Binding var home: String?
    let navigate: (String) -> Void
    @Binding var clipboard: (paths: [String], move: Bool)?

    @State private var listing: FileListing?
    @State private var error: String?
    @State private var query = ""
    @State private var showHidden = false
    @AppStorage("files/sort") private var sort = "name"
    @State private var renaming: FileEntry?
    @State private var newName = ""
    @State private var creatingFolder = false
    @State private var trashing: [FileEntry]?
    @State private var editMode: EditMode = .inactive
    @State private var selection: Set<String> = []
    @State private var importing = false
    @State private var photos: [PhotosPickerItem] = []
    @State private var pickingPhotos = false
    @State private var goingTo = false
    @State private var goPath = ""

    var body: some View {
        // 只在选择时绑定选中：绑着时点按文件夹会变成选中它，不再打开
        List(selection: editMode.isEditing ? $selection : nil) {
            if let error {
                Text(error).foregroundStyle(.red).font(.footnote)
            }
            ForEach(entries) { entry in
                row(entry)
            }
        }
        .listStyle(.plain)
        .environment(\.editMode, $editMode)
        // 选择时底部是对选中项的操作，标签栏会盖住它
        .toolbar(editMode.isEditing ? .hidden : .automatic, for: .tabBar)
        .overlay {
            if listing == nil && error == nil { ProgressView() }
            else if listing != nil && entries.isEmpty { ContentUnavailableView(query.isEmpty ? "空文件夹" : "没有匹配的文件", systemImage: "folder") }
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(path == nil ? .large : .inline)
        .searchable(text: $query, prompt: "在这个文件夹里查找")
        .refreshable { await load() }
        .task { await load() }
        .toolbar { toolbar }
        .alert("重命名", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("名称", text: $newName)
            Button("取消", role: .cancel) {}
            Button("保存") {
                if let entry = renaming { run { try await FilesAPI.rename(entry.path, to: newName) } }
            }
        }
        .alert("新建文件夹", isPresented: $creatingFolder) {
            TextField("名称", text: $newName)
            Button("取消", role: .cancel) {}
            Button("创建") {
                if let current = listing?.path { run { try await FilesAPI.createDirectory(in: current, name: newName) } }
            }
        }
        .alert("前往文件夹", isPresented: $goingTo) {
            TextField("/Users/…", text: $goPath)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            Button("取消", role: .cancel) {}
            Button("前往") { navigate(goPath) }
        }
        .confirmationDialog(
            trashing?.count == 1 ? "移到废纸篓？" : "将 \(trashing?.count ?? 0) 个项目移到废纸篓？",
            isPresented: Binding(get: { trashing != nil }, set: { if !$0 { trashing = nil } }),
            titleVisibility: .visible,
            presenting: trashing
        ) { items in
            Button("移到废纸篓", role: .destructive) {
                finishSelecting()
                run { try await FilesAPI.run(.trash(paths: items.map(\.path))) }
            }
        } message: { items in
            Text(items.count == 1 ? items[0].name : "文件会移到 macOS 的废纸篓。")
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
            guard case .success(let urls) = result else { return }
            Task {
                for url in urls {
                    let accessing = url.startAccessingSecurityScopedResource()
                    defer { if accessing { url.stopAccessingSecurityScopedResource() } }
                    if let data = try? Data(contentsOf: url) { await upload(name: url.lastPathComponent, data: data) }
                }
                await load()
            }
        }
        .photosPicker(isPresented: $pickingPhotos, selection: $photos, matching: .any(of: [.images, .videos]))
        .onChange(of: photos) { _, items in
            guard !items.isEmpty else { return }
            photos = []
            Task {
                for (offset, item) in items.enumerated() {
                    guard let data = try? await item.loadTransferable(type: Data.self) else { continue }
                    let ext = item.supportedContentTypes.first?.preferredFilenameExtension ?? "jpg"
                    await upload(name: "IMG-\(Int(Date.now.timeIntervalSince1970))-\(offset).\(ext)", data: data)
                }
                await load()
            }
        }
    }

    private var title: String {
        guard let current = listing?.path ?? path else { return "文件" }
        if current == home { return "个人" }
        return current == "/" ? "Macintosh HD" : (current as NSString).lastPathComponent
    }

    private var entries: [FileEntry] {
        var items = listing?.entries ?? []
        if !showHidden { items = items.filter { !$0.name.hasPrefix(".") } }
        let needle = query.trimmingCharacters(in: .whitespaces)
        if !needle.isEmpty { items = items.filter { $0.name.localizedCaseInsensitiveContains(needle) } }
        return items.sorted { a, b in
            if a.directory != b.directory { return a.directory }
            switch sort {
            case "modified": return a.modified > b.modified
            case "size": return a.size > b.size
            default: return a.name.localizedStandardCompare(b.name) == .orderedAscending
            }
        }
    }

    private var selectedEntries: [FileEntry] { entries.filter { selection.contains($0.path) } }

    private func finishSelecting() {
        editMode = .inactive
        selection = []
    }

    private func row(_ entry: FileEntry) -> some View {
        Group {
            // 选择时点按只切换选中，不打开文件
            if editMode.isEditing {
                FileRow(entry: entry)
            } else if entry.directory {
                NavigationLink(value: entry.path) { FileRow(entry: entry) }
            } else {
                Button {
                    FilePresenter.shared.present(url: FilesAPI.downloadURL(entry.path), name: entry.name)
                } label: {
                    FileRow(entry: entry)
                }
                .foregroundStyle(.primary)
            }
        }
        .swipeActions {
            Button("移到废纸篓", systemImage: "trash", role: .destructive) { trashing = [entry] }
            Button("重命名", systemImage: "pencil") {
                newName = entry.name
                renaming = entry
            }
        }
        .contextMenu {
            Button("重命名", systemImage: "pencil") {
                newName = entry.name
                renaming = entry
            }
            Button("复制", systemImage: "doc.on.doc") { clipboard = ([entry.path], false) }
            Button("剪切", systemImage: "scissors") { clipboard = ([entry.path], true) }
            Button("拷贝路径", systemImage: "link") { UIPasteboard.general.string = entry.path }
            Divider()
            Button("移到废纸篓", systemImage: "trash", role: .destructive) { trashing = [entry] }
        }
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .primaryAction) {
            if editMode.isEditing {
                Button("完成") { finishSelecting() }
            } else {
                Button("选择") { editMode = .active }
            }
        }
        if editMode.isEditing {
            ToolbarItemGroup(placement: .bottomBar) {
                let items = selectedEntries
                Button("复制", systemImage: "doc.on.doc") {
                    clipboard = (items.map(\.path), false)
                    finishSelecting()
                }
                .disabled(items.isEmpty)
                Button("剪切", systemImage: "scissors") {
                    clipboard = (items.map(\.path), true)
                    finishSelecting()
                }
                .disabled(items.isEmpty)
                Spacer()
                Text(items.isEmpty ? "选择项目" : "已选 \(items.count) 项").font(.footnote)
                Spacer()
                Button("移到废纸篓", systemImage: "trash", role: .destructive) { trashing = items }
                    .disabled(items.isEmpty)
            }
        }
        ToolbarItem(placement: .primaryAction) {
            Menu {
                Menu("位置", systemImage: "externaldrive") {
                    if let home {
                        Button("个人", systemImage: "house") { navigate(home) }
                        Button("桌面", systemImage: "menubar.dock.rectangle") { navigate(home + "/Desktop") }
                        Button("文稿", systemImage: "doc") { navigate(home + "/Documents") }
                        Button("下载", systemImage: "arrow.down.circle") { navigate(home + "/Downloads") }
                        Button("图片", systemImage: "photo") { navigate(home + "/Pictures") }
                        Button("废纸篓", systemImage: "trash") { navigate(home + "/.Trash") }
                    }
                    Button("Macintosh HD", systemImage: "internaldrive") { navigate("/") }
                    Button("外接磁盘", systemImage: "externaldrive") { navigate("/Volumes") }
                    Button("前往文件夹…", systemImage: "arrow.right") {
                        goPath = listing?.path ?? ""
                        goingTo = true
                    }
                }
                Section {
                    Button("新建文件夹", systemImage: "folder.badge.plus") {
                        newName = "未命名文件夹"
                        creatingFolder = true
                    }
                    Button("上传文件", systemImage: "square.and.arrow.up") { importing = true }
                    Button("上传照片", systemImage: "photo.on.rectangle") { pickingPhotos = true }
                    if let clipboard, let current = listing?.path {
                        Button("粘贴 \(clipboard.paths.count) 项", systemImage: "doc.on.clipboard") {
                            run(onSuccess: { self.clipboard = nil }) {
                                try await FilesAPI.run(clipboard.move ? .move(paths: clipboard.paths, destination: current) : .copy(paths: clipboard.paths, destination: current))
                            }
                        }
                    }
                }
                Section {
                    Picker("排序", selection: $sort) {
                        Text("名称").tag("name")
                        Text("修改时间").tag("modified")
                        Text("大小").tag("size")
                    }
                    Toggle("显示隐藏文件", isOn: $showHidden)
                }
            } label: {
                Image(systemName: "ellipsis")
            }
        }
    }

    private func load() async {
        do {
            let result = try await FilesAPI.list(path)
            listing = result
            home = result.home
            error = nil
        } catch is CancellationError {
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func upload(name: String, data: Data) async {
        guard let current = listing?.path else { return }
        do {
            try await FilesAPI.upload(directory: current, name: name, data: data)
        } catch {
            self.error = "上传 \(name) 失败：\(error.localizedDescription)"
        }
    }

    private func run(onSuccess: @escaping () -> Void = {}, _ operation: @escaping () async throws -> Void) {
        Task {
            var failure: String?
            do {
                try await operation()
                onSuccess()
            } catch {
                failure = error.localizedDescription
            }
            // 重新读取会清掉错误，没做成的原因在读完之后再显示
            await load()
            if let failure { error = failure }
        }
    }
}

private struct FileRow: View {
    let entry: FileEntry

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: entry.directory ? "folder.fill" : FileKind.icon(entry.name))
                .font(.title3)
                .foregroundStyle(entry.directory ? AnyShapeStyle(.tint) : AnyShapeStyle(.secondary))
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 4) {
                    Text(entry.name).lineLimit(1).truncationMode(.middle)
                    if entry.symlink { Image(systemName: "arrow.turn.up.right").font(.caption2).foregroundStyle(.secondary) }
                }
                HStack(spacing: 6) {
                    if entry.modified > 0 {
                        Text(Date(timeIntervalSince1970: entry.modified / 1000), format: .dateTime.year().month().day().hour().minute())
                    }
                    if !entry.directory { Text(Format.bytes(entry.size)) }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
        }
    }
}
