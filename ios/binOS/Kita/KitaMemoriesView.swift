import SwiftUI

enum MemoryKind {
    static func name(_ kind: String) -> String { kind == "inferred" ? "推测" : "已确认" }
    static func scopeName(_ scope: String) -> String { scope == "personal" ? "个人" : AppsStore.shared.name(scope) }
}

// 长期记忆：推测的待确认，和已确认的分开放
struct KitaMemoriesView: View {
    private let store = KitaStore.shared
    private let hub = EventHub.shared
    @State private var adding = false
    @State private var error: String?

    var body: some View {
        let memories = store.memories ?? []
        let inferred = memories.filter { $0.kind == "inferred" }
        let stated = memories.filter { $0.kind != "inferred" }
        List {
            if let error {
                Text(error).foregroundStyle(.red).font(.footnote)
            }
            if !inferred.isEmpty {
                Section("待确认") {
                    ForEach(inferred) { row($0) }
                }
            }
            Section("已确认") {
                if store.memories != nil && stated.isEmpty {
                    Text("无").foregroundStyle(.secondary)
                }
                ForEach(stated) { row($0) }
            }
        }
        .overlay { if store.memories == nil { ProgressView() } }
        .navigationTitle("记忆")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("添加记忆", systemImage: "plus") { adding = true }
            }
        }
        .sheet(isPresented: $adding) {
            NavigationStack { NewMemorySheet() }
        }
        .refreshable { await store.refresh() }
        .task(id: hub.kita) { await store.refresh() }
    }

    private func row(_ memory: Memory) -> some View {
        NavigationLink(value: MoreRoute.kitaMemory(memory.id)) {
            VStack(alignment: .leading, spacing: 4) {
                Text(memory.text).lineLimit(4)
                MemoryMeta(memory: memory)
            }
        }
        .swipeActions(edge: .trailing) {
            Button("删除", systemImage: "trash", role: .destructive) { run { try await KitaAPI.removeMemory(memory.id) } }
            if !memory.history.isEmpty {
                Button("恢复上一版", systemImage: "arrow.uturn.backward") { run { try await KitaAPI.revertMemory(memory.id) } }
                    .tint(.indigo)
            }
        }
        .swipeActions(edge: .leading) {
            if memory.kind == "inferred" {
                Button("确认", systemImage: "checkmark") { run { try await KitaAPI.updateMemory(memory.id, .init(kind: "stated")) } }
                    .tint(.green)
            }
        }
    }

    private func run(_ action: @escaping () async throws -> Void) {
        Task {
            do {
                try await action()
                error = nil
            } catch {
                self.error = error.localizedDescription
            }
            await store.refresh()
        }
    }
}

// 一条记忆的来源、更新时间和范围
private struct MemoryMeta: View {
    let memory: Memory

    var body: some View {
        HStack(spacing: 4) {
            MemorySourceLabel(source: memory.source)
            Text("·")
            Text(Date(iso: memory.updatedAt) ?? .now, format: .relative(presentation: .named))
            if memory.scope != "personal" {
                Text("· \(MemoryKind.scopeName(memory.scope))")
            }
        }
        .font(.caption)
        .foregroundStyle(.secondary)
        .lineLimit(1)
    }
}

// 谁写的：手动添加、喜多的某段对话（点开去看），或者别的 app
struct MemorySourceLabel: View {
    let source: MemorySource
    var linked = false

    var body: some View {
        if source.type == "user" {
            Text("手动添加")
        } else if source.owner == "kita", let session = source.session, let conversation = KitaStore.shared.conversation(session) {
            if linked {
                NavigationLink(value: MoreRoute.kitaChat(conversation.id, temporary: conversation.temporary)) {
                    Text(conversation.title.isEmpty ? "对话" : conversation.title)
                }
            } else {
                Text(conversation.title.isEmpty ? "对话" : conversation.title)
            }
        } else {
            Text(AppsStore.shared.name(source.owner ?? ""))
        }
    }
}

private struct NewMemorySheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var kind = "stated"
    @State private var scope = "personal"
    @State private var saving = false
    @State private var error: String?

    var body: some View {
        Form {
            Section {
                TextField("记忆的内容", text: $text, axis: .vertical)
                    .lineLimit(3...10)
            }
            Section {
                Picker("类别", selection: $kind) {
                    Text("已确认").tag("stated")
                    Text("推测").tag("inferred")
                }
                TextField("范围", text: $scope)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            } footer: {
                Text("范围是 personal（个人，喜多的对话读写这里）或某个 app 的 id，只用小写字母、数字和连字符")
            }
            if let error {
                Text(error).foregroundStyle(.red)
            }
        }
        .navigationTitle("添加记忆")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
            ToolbarItem(placement: .confirmationAction) {
                Button("添加") { Task { await save() } }
                    .disabled(saving || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || scope.wholeMatch(of: /[a-z0-9-]{1,40}/) == nil)
            }
        }
    }

    private func save() async {
        saving = true
        defer { saving = false }
        do {
            try await KitaAPI.addMemory(.init(text: text.trimmingCharacters(in: .whitespacesAndNewlines), kind: kind, scope: scope))
            await KitaStore.shared.refresh()
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

// 一条记忆：改内容和类别、恢复上一版、删除，以及来源和改动的历史
struct KitaMemoryView: View {
    let id: String
    private let store = KitaStore.shared
    @State private var editing: String?
    @State private var error: String?
    @State private var deleting = false
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        if let memory = store.memories?.first(where: { $0.id == id }) {
            Form {
                Section("内容") {
                    if let editing {
                        TextField("记忆的内容", text: Binding(get: { editing }, set: { self.editing = $0 }), axis: .vertical)
                            .lineLimit(2...12)
                        HStack {
                            Button("取消") { self.editing = nil }
                            Spacer()
                            Button("保存") { save(memory) }
                                .buttonStyle(.borderedProminent)
                                .disabled(editing.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        }
                        .buttonStyle(.borderless)
                    } else {
                        Text(memory.text).textSelection(.enabled)
                        Button("修改", systemImage: "pencil") { editing = memory.text }
                    }
                }
                Section {
                    Picker("类别", selection: Binding(get: { memory.kind }, set: { kind in run { try await KitaAPI.updateMemory(memory.id, .init(kind: kind)) } })) {
                        Text("已确认").tag("stated")
                        Text("推测").tag("inferred")
                    }
                    LabeledContent("范围", value: MemoryKind.scopeName(memory.scope))
                    LabeledContent("来源") { MemorySourceLabel(source: memory.source, linked: true) }
                    if let created = Date(iso: memory.createdAt) { LabeledContent("记下", value: created.formatted(date: .abbreviated, time: .shortened)) }
                    if let updated = Date(iso: memory.updatedAt) { LabeledContent("更新", value: updated.formatted(date: .abbreviated, time: .shortened)) }
                } footer: {
                    if memory.kind == "inferred" { Text("推测的记忆是 agent 从交流中推断的，确认前不会当作事实") }
                }
                if !memory.history.isEmpty {
                    Section("之前的版本") {
                        ForEach(Array(memory.history.enumerated().reversed()), id: \.offset) { _, version in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(version.text).foregroundStyle(.secondary)
                                HStack(spacing: 4) {
                                    Text(MemoryKind.name(version.kind))
                                    Text("·")
                                    MemorySourceLabel(source: version.source)
                                    Text("·")
                                    Text(Date(iso: version.time) ?? .now, format: .relative(presentation: .named))
                                }
                                .font(.caption)
                                .foregroundStyle(.tertiary)
                            }
                        }
                        Button("恢复上一版", systemImage: "arrow.uturn.backward") { run { try await KitaAPI.revertMemory(memory.id) } }
                    }
                }
                if let error {
                    Text(error).foregroundStyle(.red)
                }
                Section {
                    Button("删除这条记忆", systemImage: "trash", role: .destructive) { deleting = true }
                }
            }
            .navigationTitle("记忆")
            .navigationBarTitleDisplayMode(.inline)
            .confirmationDialog("删除这条记忆？", isPresented: $deleting, titleVisibility: .visible) {
                Button("删除", role: .destructive) {
                    Task {
                        do {
                            try await KitaAPI.removeMemory(memory.id)
                            await store.refresh()
                            dismiss()
                        } catch {
                            self.error = error.localizedDescription
                        }
                    }
                }
            }
        } else {
            ContentUnavailableView("这条记忆不存在", systemImage: "brain")
        }
    }

    private func save(_ memory: Memory) {
        guard let text = editing?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else { return }
        if text == memory.text {
            editing = nil
            return
        }
        Task {
            do {
                try await KitaAPI.updateMemory(memory.id, .init(text: text))
                editing = nil
                error = nil
            } catch {
                self.error = error.localizedDescription
            }
            await store.refresh()
        }
    }

    private func run(_ action: @escaping () async throws -> Void) {
        Task {
            do {
                try await action()
                error = nil
            } catch {
                self.error = error.localizedDescription
            }
            await store.refresh()
        }
    }
}
