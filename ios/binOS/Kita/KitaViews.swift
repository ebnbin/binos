import PhotosUI
import SwiftUI

// 头像是用户选的喜多的照片；还没有照片时只显示 app 的图标。busy：喜多在某个 app 里回答
struct KitaAvatar: View {
    let profile: KitaProfile?
    let size: CGFloat
    var busy = false

    var body: some View {
        Group {
            if let avatar = profile?.avatar {
                RemoteImage(url: KitaAPI.photoURL(avatar), contentMode: .fill)
            } else {
                Image(systemName: "cat")
                    .font(.system(size: size * 0.5, weight: .light))
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(.quaternary)
            }
        }
        .frame(width: size, height: size)
        .clipShape(.circle)
        .overlay {
            if busy { Circle().strokeBorder(Color.accentColor, lineWidth: max(size / 24, 2)) }
        }
        .accessibilityLabel("喜多")
    }
}

// 喜多：身份、对话列表、新对话和临时对话、记忆
struct KitaHomeView: View {
    private let store = KitaStore.shared
    private let hub = EventHub.shared
    @State private var error: String?

    var body: some View {
        List {
            Section {
                NavigationLink(value: MoreRoute.kitaProfile) {
                    HStack(spacing: 12) {
                        KitaAvatar(profile: store.profile, size: 48, busy: store.status.busy)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("喜多").font(.headline)
                            Text(store.status.label).font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                }
            }
            Section {
                NavigationLink(value: MoreRoute.kitaChat(nil, temporary: false)) { Label("新对话", systemImage: "bubble.left.and.text.bubble.right") }
                NavigationLink(value: MoreRoute.kitaChat(nil, temporary: true)) { Label("临时对话", systemImage: "eye.slash") }
                NavigationLink(value: MoreRoute.kitaMemories) {
                    LabeledContent {
                        if let count = store.memories?.count, count > 0 { Text("\(count)") }
                    } label: {
                        Label("记忆", systemImage: "brain")
                    }
                }
            }
            Section("对话") {
                if store.failed && store.conversations == nil {
                    Text("读取失败").foregroundStyle(.secondary)
                } else if store.conversations?.isEmpty == true {
                    Text("还没有对话").foregroundStyle(.secondary)
                }
                ForEach(store.conversations ?? []) { conversation in
                    NavigationLink(value: MoreRoute.kitaChat(conversation.id, temporary: conversation.temporary)) {
                        ConversationRow(conversation: conversation)
                    }
                    .swipeActions {
                        if conversation.state == "idle" {
                            Button("删除", systemImage: "trash", role: .destructive) { delete(conversation) }
                        }
                    }
                    .contextMenu {
                        if conversation.state == "idle" {
                            Button("删除对话", systemImage: "trash", role: .destructive) { delete(conversation) }
                        }
                    }
                }
                if let error {
                    Text(error).font(.footnote).foregroundStyle(.red)
                }
            }
        }
        .overlay { if store.conversations == nil && !store.failed { ProgressView() } }
        .navigationTitle("喜多")
        .refreshable { await store.refresh() }
        .task(id: hub.kita + hub.sessions) { await store.refresh() }
    }

    private func delete(_ conversation: KitaConversation) {
        Task {
            do {
                try await KitaAPI.delete(conversation.id)
                error = nil
            } catch {
                self.error = error.localizedDescription
            }
            await store.refresh()
        }
    }
}

private struct ConversationRow: View {
    let conversation: KitaConversation

    var body: some View {
        HStack(spacing: 8) {
            if conversation.temporary {
                Image(systemName: "eye.slash").font(.caption).foregroundStyle(.secondary).accessibilityLabel("临时对话")
            }
            Text(conversation.title.isEmpty ? "对话" : conversation.title).lineLimit(1)
            Spacer(minLength: 4)
            if conversation.state != "idle" {
                ProgressView().controlSize(.small).accessibilityLabel("正在回答")
            } else {
                if conversation.outcome == "error" { Image(systemName: "exclamationmark.circle").foregroundStyle(.red) }
                Text(conversation.updated, format: .relative(presentation: .named)).font(.caption).foregroundStyle(.secondary)
            }
        }
    }
}

// 和喜多的一段对话；id 为 nil 是新对话，第一句发出后换成它的 id。temporary 只对新对话有意义
struct KitaChatView: View {
    let id: String?
    let temporary: Bool

    private let store = KitaStore.shared
    private let hub = EventHub.shared
    @State private var created: String?
    @State private var stream: KitaSessionStream?
    @State private var input = ""
    @State private var sending = false
    @State private var notice: String?
    @State private var agent = Agents.defaultAgent
    @State private var deleting = false
    @FocusState private var focused: Bool
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase

    private var thread: String? { id ?? created }
    private var conversation: KitaConversation? { thread.flatMap(store.conversation) }
    private var isTemporary: Bool { conversation?.temporary ?? temporary }
    private var running: Bool { stream?.live != nil }
    // 刚建好的对话可能还没出现在列表里，不能当成不存在
    private var missing: Bool { id != nil && store.conversations != nil && conversation == nil }

    var body: some View {
        Group {
            if thread == nil {
                empty
            } else if missing && stream?.loaded != true {
                ContentUnavailableView("这个对话不存在", systemImage: "questionmark.bubble")
            } else if let stream, stream.loaded {
                TranscriptScroll(stream: stream, notice: notice)
                    .id(stream.thread)
            } else {
                ProgressView()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .safeAreaInset(edge: .bottom, spacing: 0) { composer }
        .navigationTitle(thread == nil ? (temporary ? "临时对话" : "新对话") : (conversation?.title ?? ""))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let thread, conversation?.state == "idle" {
                ToolbarItem(placement: .primaryAction) {
                    Button("删除对话", systemImage: "trash") { deleting = true }
                        .confirmationDialog("删除这个对话？", isPresented: $deleting, titleVisibility: .visible) {
                            Button("删除", role: .destructive) {
                                Task {
                                    do {
                                        try await KitaAPI.delete(thread)
                                        await store.refresh()
                                        dismiss()
                                    } catch {
                                        notice = error.localizedDescription
                                    }
                                }
                            }
                        }
                }
            }
        }
        .onChange(of: thread, initial: true) { _, thread in
            guard let thread, stream?.thread != thread else { return }
            stream?.stop()
            let next = KitaSessionStream(thread: thread)
            next.start()
            stream = next
        }
        .onAppear { stream?.start() }
        .onDisappear { stream?.stop() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { stream?.reconnectIfStale() }
        }
        .task(id: hub.kita) { await store.refresh() }
    }

    private var empty: some View {
        VStack(spacing: 12) {
            if isTemporary {
                Image(systemName: "eye.slash")
                    .font(.system(size: 28, weight: .light))
                    .frame(width: 88, height: 88)
                    .background(.quaternary, in: .circle)
                Text("临时对话").font(.title2.bold())
            } else {
                KitaAvatar(profile: store.profile, size: 88)
                Text("喜多").font(.title2.bold())
            }
            if let notice {
                Text(notice).font(.footnote).foregroundStyle(.red)
            }
        }
        .padding()
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .bottom, spacing: 8) {
                TextField(running ? "补充或纠正" : "输入消息", text: $input, axis: .vertical)
                    .lineLimit(1...8)
                    .focused($focused)
                    .disabled(sending)
                    .padding(.vertical, 6)
                if sending {
                    ProgressView().frame(width: 34, height: 34)
                } else if running && input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Button {
                        if let thread { Task { await KitaAPI.stop(thread) } }
                    } label: {
                        Image(systemName: "stop.fill").frame(width: 34, height: 34)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.red)
                    .clipShape(.circle)
                    .accessibilityLabel("停止")
                } else {
                    Button {
                        Task { await send() }
                    } label: {
                        Image(systemName: "arrow.up").font(.body.weight(.semibold)).frame(width: 34, height: 34)
                    }
                    .buttonStyle(.borderedProminent)
                    .clipShape(.circle)
                    .disabled(input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .accessibilityLabel("发送")
                }
            }
            HStack(spacing: 12) {
                if thread == nil {
                    // 新对话能选能用的 agent，已有的对话沿用它的
                    let choosable = store.catalogs.filter { $0.available || $0.agent == agent }.map(\.agent)
                    Picker("agent", selection: $agent) {
                        ForEach(choosable.isEmpty ? [agent] : choosable, id: \.self) { Text(Agents.name($0)).tag($0) }
                    }
                    .pickerStyle(.menu)
                    .labelsHidden()
                    .fixedSize()
                } else if let conversation {
                    Text(Agents.name(conversation.agent))
                }
                Text(isTemporary ? "不带记忆" : "\(store.personalMemories) 条记忆")
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .glassEffect(in: .rect(cornerRadius: 22))
        .padding(.horizontal, 10)
        .padding(.bottom, 6)
    }

    private func send() async {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !sending else { return }
        sending = true
        notice = nil
        defer { sending = false }
        do {
            if let thread {
                try await KitaAPI.send(thread, text: text)
            } else {
                created = try await KitaAPI.start(text: text, temporary: temporary, agent: agent)
            }
            input = ""
            await store.refresh()
        } catch {
            notice = error.localizedDescription
        }
    }
}

// 喜多的照片、头像和描述
struct KitaProfileView: View {
    private let store = KitaStore.shared
    private let hub = EventHub.shared
    @State private var description: String?
    @State private var notice: String?
    @State private var saving = false
    @State private var picked: [PhotosPickerItem] = []
    @State private var uploading = false
    @State private var removing: KitaPhoto?

    private var text: String { description ?? store.profile?.description ?? "" }
    private var changed: Bool { description != nil && description != store.profile?.description }

    var body: some View {
        Form {
            Section {
                VStack(spacing: 8) {
                    KitaAvatar(profile: store.profile, size: 96)
                    Text("喜多").font(.title2.bold())
                }
                .frame(maxWidth: .infinity)
                .listRowBackground(Color.clear)
            }
            if let notice {
                Text(notice).foregroundStyle(.red)
            }
            Section {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 96), spacing: 8)], spacing: 8) {
                    ForEach(store.profile?.photos ?? [], id: \.file) { photo in
                        photoCell(photo)
                    }
                    PhotosPicker(selection: $picked, matching: .images) {
                        VStack(spacing: 6) {
                            if uploading { ProgressView() } else { Image(systemName: "photo.badge.plus").font(.title2) }
                            Text("添加照片").font(.caption)
                        }
                        .frame(maxWidth: .infinity, minHeight: 96)
                        .background(.quaternary, in: .rect(cornerRadius: 12))
                    }
                    .disabled(uploading)
                }
                .padding(.vertical, 4)
            } header: {
                Text("照片")
            } footer: {
                Text("点一张照片用作头像，长按可以删除")
            }
            Section("描述") {
                TextEditor(text: Binding(get: { text }, set: { description = $0 }))
                    .frame(minHeight: 180)
                    .accessibilityLabel("喜多的描述")
                HStack {
                    if changed {
                        Button("还原") { description = nil }
                    }
                    Spacer()
                    Button("保存") { Task { await save() } }
                        .buttonStyle(.borderedProminent)
                        .disabled(!changed || saving)
                }
            }
        }
        .scrollDismissesKeyboard(.interactively)
        .navigationTitle("喜多")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: hub.kita) { await store.refresh() }
        .onChange(of: picked) { _, items in
            guard !items.isEmpty else { return }
            picked = []
            Task { await upload(items) }
        }
        .confirmationDialog("删除这张照片？", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
            Button("删除", role: .destructive) {
                if let photo = removing { run { try await KitaAPI.removePhoto(photo.file) } }
            }
        }
    }

    private func photoCell(_ photo: KitaPhoto) -> some View {
        let isAvatar = photo.file == store.profile?.avatar
        return Button {
            if !isAvatar { run { try await KitaAPI.setAvatar(photo.file) } }
        } label: {
            RemoteImage(url: KitaAPI.photoURL(photo.file), contentMode: .fill)
                .frame(minWidth: 96, maxWidth: .infinity, minHeight: 96, maxHeight: 96)
                .clipShape(.rect(cornerRadius: 12))
                .overlay {
                    if isAvatar { RoundedRectangle(cornerRadius: 12).strokeBorder(Color.accentColor, lineWidth: 3) }
                }
                .overlay(alignment: .bottomTrailing) {
                    if isAvatar {
                        Image(systemName: "checkmark.circle.fill").foregroundStyle(.white, Color.accentColor).padding(6)
                    }
                }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(isAvatar ? "当前的头像" : "用作头像")
        .contextMenu {
            if !isAvatar {
                Button("用作头像", systemImage: "person.crop.circle") { run { try await KitaAPI.setAvatar(photo.file) } }
            }
            Button("删除这张照片", systemImage: "trash", role: .destructive) { removing = photo }
        }
    }

    private func run(_ action: @escaping () async throws -> Void) {
        Task {
            do {
                try await action()
                notice = nil
            } catch {
                notice = error.localizedDescription
            }
            await store.refresh()
        }
    }

    private func upload(_ items: [PhotosPickerItem]) async {
        uploading = true
        notice = nil
        defer { uploading = false }
        for item in items {
            guard let data = try? await item.loadTransferable(type: Data.self) else { continue }
            let ext = item.supportedContentTypes.first?.preferredFilenameExtension ?? "jpg"
            let name = "\(item.itemIdentifier ?? UUID().uuidString).\(ext)".replacing("/", with: "-")
            do {
                try await KitaAPI.upload(data, name: name)
            } catch {
                notice = error.localizedDescription
            }
        }
        await store.refresh()
    }

    private func save() async {
        saving = true
        defer { saving = false }
        do {
            try await KitaAPI.saveDescription(text)
            await store.refresh()
            description = nil
        } catch {
            notice = "保存失败，请重试"
        }
    }
}
