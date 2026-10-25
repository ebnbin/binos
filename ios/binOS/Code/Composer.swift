import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

// 待发的附件
struct PendingFile: Identifiable {
    let id = UUID()
    let name: String
    let data: Data
    let thumbnail: UIImage?
}

// 输入框：附件、排队的消息、模型和思考程度、用量，以及发送、停止、打断、排队
struct Composer: View {
    let store: CodeStore
    let sessionId: Int?
    let session: SessionSummary?
    let running: Bool
    let choice: Choice
    let agentFixed: Bool
    let draftKey: String
    let onChoice: (Choice) -> Void
    let onSend: (String, [PendingFile], SendMode) async -> Bool
    let onStop: () -> Void

    @State private var input = ""
    @State private var pending: [PendingFile] = []
    @State private var sending = false
    @State private var photos: [PhotosPickerItem] = []
    @State private var showingPhotos = false
    @State private var showingFiles = false
    @State private var showingUsage = false
    @FocusState private var focused: Bool

    private var hasContent: Bool { !input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !pending.isEmpty }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let session, !session.queue.isEmpty, let sessionId {
                QueueList(queue: session.queue, running: running, sessionId: sessionId) { text in
                    input = input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? text : input + "\n" + text
                }
            }
            if !pending.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(pending) { file in
                            PendingChip(file: file) { pending.removeAll { $0.id == file.id } }
                                .disabled(sending)
                        }
                    }
                    .padding(.top, 6)
                }
            }
            TextField(running ? "补充或纠正，agent 会在下一步看到" : "输入消息", text: $input, axis: .vertical)
                .lineLimit(1...8)
                .focused($focused)
                .disabled(sending)
                .padding(.horizontal, 4)
            HStack(spacing: 12) {
                Menu {
                    Button("照片", systemImage: "photo.on.rectangle") { showingPhotos = true }
                    Button("文件", systemImage: "folder") { showingFiles = true }
                    Button("粘贴", systemImage: "doc.on.clipboard") { pasteImage() }
                } label: {
                    Image(systemName: "paperclip")
                }
                .disabled(sending)
                ModelMenu(store: store, choice: choice, agentFixed: agentFixed, running: running, onChoice: onChoice)
                Spacer(minLength: 0)
                if let session {
                    Button { showingUsage = true } label: { ContextRing(session: session) }
                        .popover(isPresented: $showingUsage) {
                            UsagePanel(store: store, session: session)
                                .presentationCompactAdaptation(.popover)
                        }
                }
                actions
            }
            .font(.body)
            .tint(.primary)
        }
        .padding(12)
        .glassEffect(.regular, in: .rect(cornerRadius: 24))
        .padding(.horizontal, 10)
        .padding(.bottom, 6)
        .frame(maxWidth: 820)
        .frame(maxWidth: .infinity)
        .photosPicker(isPresented: $showingPhotos, selection: $photos, matching: .any(of: [.images, .videos]))
        .fileImporter(isPresented: $showingFiles, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
            if case .success(let urls) = result { addFiles(urls) }
        }
        .onChange(of: photos) { _, items in
            guard !items.isEmpty else { return }
            photos = []
            Task { await addPhotos(items) }
        }
        .onAppear { input = UserDefaults.standard.string(forKey: "code/draft/\(draftKey)") ?? "" }
        .onChange(of: draftKey) { _, key in input = UserDefaults.standard.string(forKey: "code/draft/\(key)") ?? "" }
        .onChange(of: input) { _, text in
            if text.isEmpty {
                UserDefaults.standard.removeObject(forKey: "code/draft/\(draftKey)")
            } else {
                UserDefaults.standard.set(text, forKey: "code/draft/\(draftKey)")
            }
        }
    }

    @ViewBuilder
    private var actions: some View {
        if sending {
            ProgressView()
                .frame(width: 34, height: 34)
        } else if running && !hasContent {
            Button(action: onStop) {
                Image(systemName: "stop.fill")
                    .font(.body)
                    .frame(width: 34, height: 34)
                    .foregroundStyle(.white)
                    .background(.red, in: .circle)
            }
            .accessibilityLabel("停止")
        } else {
            if running {
                Button { send(.interrupt) } label: { Label("打断", systemImage: "bolt.fill").labelStyle(.titleAndIcon) }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                Button { send(.queue) } label: { Label("排队", systemImage: "text.badge.plus").labelStyle(.titleAndIcon) }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
            }
            Button { send(.send) } label: {
                Image(systemName: "arrow.up")
                    .font(.body.bold())
                    .frame(width: 34, height: 34)
                    .foregroundStyle(.white)
                    .background(hasContent ? Color.accentColor : Color.gray.opacity(0.4), in: .circle)
            }
            .disabled(!hasContent)
            .accessibilityLabel(running ? "插话" : "发送")
        }
    }

    private func send(_ mode: SendMode) {
        guard hasContent, !sending else { return }
        sending = true
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        Task {
            if await onSend(text, pending, running ? mode : .send) {
                input = ""
                pending = []
            }
            sending = false
        }
    }

    private func addPhotos(_ items: [PhotosPickerItem]) async {
        for item in items {
            guard let data = try? await item.loadTransferable(type: Data.self) else { continue }
            let type = item.supportedContentTypes.first
            let ext = type?.preferredFilenameExtension ?? "jpg"
            let name = "photo-\(Date.now.formatted(.iso8601.year().month().day().time(includingFractionalSeconds: false)).replacing(":", with: "")).\(ext)"
            pending.append(PendingFile(name: name, data: data, thumbnail: UIImage(data: data)?.preparingThumbnail(of: CGSize(width: 160, height: 160))))
        }
    }

    private func addFiles(_ urls: [URL]) {
        for url in urls {
            let accessing = url.startAccessingSecurityScopedResource()
            defer { if accessing { url.stopAccessingSecurityScopedResource() } }
            guard let data = try? Data(contentsOf: url) else { continue }
            let thumbnail = FileKind.isImage(url.lastPathComponent) ? UIImage(data: data)?.preparingThumbnail(of: CGSize(width: 160, height: 160)) : nil
            pending.append(PendingFile(name: url.lastPathComponent, data: data, thumbnail: thumbnail))
        }
    }

    // 剪贴板里是图片时当作附件，是文字时接到输入框
    private func pasteImage() {
        if let image = UIPasteboard.general.image, let data = image.pngData() {
            pending.append(PendingFile(name: "pasted.png", data: data, thumbnail: image.preparingThumbnail(of: CGSize(width: 160, height: 160))))
        } else if let text = UIPasteboard.general.string {
            input += text
        }
    }
}

private struct PendingChip: View {
    let file: PendingFile
    let onRemove: () -> Void

    var body: some View {
        Group {
            if let thumbnail = file.thumbnail {
                Image(uiImage: thumbnail)
                    .resizable()
                    .scaledToFill()
                    .frame(width: 56, height: 56)
                    .clipShape(.rect(cornerRadius: 10))
            } else {
                Label(file.name, systemImage: FileKind.icon(file.name))
                    .font(.caption)
                    .lineLimit(1)
                    .frame(maxWidth: 160)
                    .padding(.horizontal, 10)
                    .frame(height: 56)
                    .background(.quaternary, in: .rect(cornerRadius: 10))
            }
        }
        .overlay(alignment: .topTrailing) {
            Button(action: onRemove) {
                Image(systemName: "xmark.circle.fill")
                    .symbolRenderingMode(.palette)
                    .foregroundStyle(.white, .black.opacity(0.6))
            }
            .offset(x: 6, y: -6)
            .accessibilityLabel("移除 \(file.name)")
        }
    }
}

// 排着队、等这一轮答完再发的消息：撤回到输入框，被停止或出错后可以现在就发
private struct QueueList: View {
    let queue: [QueuedMessage]
    let running: Bool
    let sessionId: Int
    let onWithdraw: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(queue) { item in
                HStack(spacing: 8) {
                    Image(systemName: "clock").foregroundStyle(.secondary)
                    Text(item.text.isEmpty ? item.attachments.first?.name ?? "" : item.text)
                        .lineLimit(1)
                    if !item.attachments.isEmpty {
                        Label("\(item.attachments.count)", systemImage: "paperclip").foregroundStyle(.secondary)
                    }
                    Spacer()
                    if !running {
                        Button("现在发送", systemImage: "arrow.up.circle") {
                            Task { await CodeAPI.sendQueued(sessionId, item: item.id) }
                        }
                        .labelStyle(.iconOnly)
                    }
                    Button("撤回到输入框", systemImage: "arrow.uturn.backward.circle") {
                        Task {
                            if let text = await CodeAPI.withdraw(sessionId, item: item.id) { onWithdraw(text) }
                        }
                    }
                    .labelStyle(.iconOnly)
                }
                .font(.footnote)
            }
        }
        .padding(8)
        .background(.quaternary.opacity(0.5), in: .rect(cornerRadius: 12))
    }
}

// 模型和思考程度：agent 只在新对话时能换
private struct ModelMenu: View {
    let store: CodeStore
    let choice: Choice
    let agentFixed: Bool
    let running: Bool
    let onChoice: (Choice) -> Void

    var body: some View {
        let catalog = store.catalogs.first { $0.agent == choice.agent }
        let models = catalog?.models ?? []
        let defaultModel = models.first { $0.isDefault == true }
        let selected = models.first { $0.id == choice.model } ?? (choice.model == nil ? defaultModel : nil)
        let efforts = models.first { $0.id == (choice.model ?? defaultModel?.id) }?.efforts ?? catalog?.efforts ?? []
        Menu {
            ForEach(store.catalogs.filter { $0.available || $0.agent == choice.agent }, id: \.agent) { item in
                Section(Agents.name(item.agent)) {
                    ForEach(item.models) { model in
                        Button {
                            let effort = item.agent == choice.agent && choice.effort.map(model.efforts.contains) == true ? choice.effort : nil
                            onChoice(Choice(agent: item.agent, model: model.isDefault == true ? nil : model.id, effort: effort))
                        } label: {
                            let isSelected = item.agent == choice.agent && (model.id == choice.model || (choice.model == nil && model.isDefault == true))
                            if isSelected {
                                Label(model.name + (model.isDefault == true ? "（默认）" : ""), systemImage: "checkmark")
                            } else {
                                Text(model.name + (model.isDefault == true ? "（默认）" : ""))
                            }
                        }
                        .disabled(agentFixed && item.agent != choice.agent)
                    }
                }
            }
            Section("思考程度") {
                ForEach([""] + efforts, id: \.self) { effort in
                    Button {
                        onChoice(Choice(agent: choice.agent, model: choice.model, effort: effort.isEmpty ? nil : effort))
                    } label: {
                        let name = effort.isEmpty ? "默认" : Agents.effortName(effort)
                        if (choice.effort ?? "") == effort {
                            Label(name, systemImage: "checkmark")
                        } else {
                            Text(name)
                        }
                    }
                }
            }
        } label: {
            HStack(spacing: 3) {
                Text(selected?.name ?? choice.model.map { Agents.modelName(choice.agent, $0) } ?? Agents.name(choice.agent))
                if let effort = choice.effort {
                    Text("· \(Agents.effortName(effort))").foregroundStyle(.secondary)
                }
                Image(systemName: "chevron.up.chevron.down").font(.caption2)
            }
            .font(.footnote)
            .lineLimit(1)
        }
        .disabled(running)
    }
}

// 上下文圆环：快满时 agent 会压缩历史
struct ContextRing: View {
    let session: SessionSummary

    var body: some View {
        let ratio = session.context.map { min(Double($0.tokens) / Double(max($0.window, 1)), 1) } ?? 0
        let color: Color = ratio >= 0.9 ? .red : ratio >= 0.7 ? .orange : .secondary
        ZStack {
            Circle().stroke(color.opacity(0.25), lineWidth: 2.5)
            Circle().trim(from: 0, to: ratio).stroke(color, style: StrokeStyle(lineWidth: 2.5, lineCap: .round)).rotationEffect(.degrees(-90))
        }
        .frame(width: 18, height: 18)
        .accessibilityLabel("上下文 \(Int(ratio * 100))%")
    }
}

// 这个会话的用量：上下文、token、约占周额度多少，以及这 7 天 binOS 用了多少
struct UsagePanel: View {
    let store: CodeStore
    let session: SessionSummary
    @State private var usage: CodeUsage?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("会话用量").font(.headline)
            if let context = session.context {
                row("上下文", "\(Format.tokens(context.tokens)) / \(Format.tokens(context.window))（\(context.tokens * 100 / max(context.window, 1))%）")
            }
            if let tokens = session.tokens {
                row("一共", "\(Format.tokens(tokens.total)) token")
                row("输入 / 输出", "\(Format.tokens(tokens.input)) / \(Format.tokens(tokens.output))")
                row("缓存读 / 写", "\(Format.tokens(tokens.cacheRead)) / \(Format.tokens(tokens.cacheWrite))")
            }
            if let quota = session.quota {
                row("约占周额度", Format.percent(quota))
            }
            if let week = store.status?.limits[session.agent]?.windows.first(where: { $0.minutes == 7 * 24 * 60 }) {
                Divider()
                row("\(Agents.name(session.agent)) 本周已用", Format.percent(week.utilization))
                if let usage, let binos = usage.week {
                    row("其中 binOS 约", Format.percent(binos))
                }
                row("重置", Date(timeIntervalSince1970: week.resetsAt).formatted(.relative(presentation: .named)))
            }
        }
        .font(.footnote)
        .padding()
        .frame(minWidth: 260)
        .task { usage = await CodeAPI.usage() }
    }

    private func row(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label).foregroundStyle(.secondary)
            Spacer()
            Text(value).monospacedDigit()
        }
    }
}
