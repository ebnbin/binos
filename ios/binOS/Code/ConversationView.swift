import SwiftUI

// 正在回答时：插话（agent 在下一步看到）、先打断再说、排到这一轮答完之后
enum SendMode { case send, interrupt, queue }

// 一个 session 的对话；sessionId 为空时是新对话
struct ConversationView: View {
    let store: CodeStore
    let sessionId: Int?
    // 新对话所属的项目
    var project: String = "binos"
    // 从搜索结果跳过来时定位到的事件的 seq
    var targetSeq: Int?
    var onCreated: (Int, String) -> Void = { _, _ in }

    @State private var stream: KitaSessionStream?
    @State private var createdThread: String?
    @State private var newProject: String?
    @State private var picked: Choice?
    @State private var notice: String?
    @State private var renaming = false
    @State private var title = ""
    @Environment(\.scenePhase) private var scenePhase

    private var session: SessionSummary? { sessionId.flatMap(store.session) }
    private var thread: String? { session?.kitaSession ?? createdThread }
    private var running: Bool { stream?.live != nil }
    private var choice: Choice { picked ?? Choice(agent: session?.agent ?? Agents.defaultAgent, model: session?.model, effort: session?.effort) }
    private var currentProject: String { session?.project ?? newProject ?? project }

    var body: some View {
        Group {
            if sessionId == nil {
                newConversation
            } else if let stream, stream.loaded {
                // 补发完了再排版，初始位置才能直接落在底部
                TranscriptScroll(stream: stream, notice: notice, targetSeq: targetSeq)
                    .id(stream.thread)
            } else if store.sessions != nil, session == nil, createdThread == nil {
                ContentUnavailableView("这个对话不存在", systemImage: "questionmark.bubble")
            } else {
                ProgressView()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            Composer(
                store: store,
                sessionId: sessionId,
                session: session,
                running: running,
                choice: choice,
                agentFixed: sessionId != nil,
                draftKey: sessionId.map(String.init) ?? "new-\(currentProject)",
                onChoice: { picked = $0 },
                onSend: send,
                onStop: { if let sessionId { Task { await CodeAPI.stop(sessionId) } } }
            )
        }
        .navigationTitle(session?.title ?? (sessionId == nil ? "新对话" : ""))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { toolbar }
        .alert("重命名", isPresented: $renaming) {
            TextField("标题", text: $title)
            Button("取消", role: .cancel) {}
            Button("保存") {
                if let sessionId, !title.trimmingCharacters(in: .whitespaces).isEmpty {
                    Task { await store.edit(sessionId, .init(title: title)) }
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
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { stream?.reconnectIfStale() }
        }
        // 正在看、又没在回答：记为已读（打开时，以及这一轮答完时）
        .task(id: "\(sessionId ?? -1)-\(running)") {
            if let sessionId, !running { await CodeAPI.markRead(sessionId) }
        }
    }

    private var newConversation: some View {
        VStack(spacing: 16) {
            Image(systemName: "bubble.left.and.text.bubble.right")
                .font(.system(size: 44))
                .foregroundStyle(.tint)
            Text("开始新对话").font(.title2.bold())
            Picker("项目", selection: Binding(get: { currentProject }, set: { newProject = $0 })) {
                ForEach(store.projects) { project in
                    Label(project.name, systemImage: "folder").tag(project.id)
                }
            }
            .pickerStyle(.menu)
            if let notice {
                Text(notice).font(.footnote).foregroundStyle(.red)
            }
        }
        .padding()
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        if let session, let sessionId {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Button("重命名", systemImage: "pencil") {
                        title = session.title
                        renaming = true
                    }
                    Button(session.pinned ? "取消置顶" : "置顶", systemImage: session.pinned ? "pin.slash" : "pin") {
                        Task { await store.edit(sessionId, .init(pinned: !session.pinned)) }
                    }
                    Button(session.archived ? "取消归档" : "归档", systemImage: "archivebox") {
                        Task { await store.edit(sessionId, .init(archived: !session.archived)) }
                    }
                    if !session.prs.isEmpty {
                        Section("Pull Request") {
                            ForEach(session.prs, id: \.url) { pr in
                                if let url = URL(string: pr.url) {
                                    Link(destination: url) {
                                        Label("#\(pr.number) \(pr.title ?? "")", systemImage: pr.state == "merged" ? "arrow.triangle.merge" : "arrow.triangle.pull")
                                    }
                                }
                                if let preview = pr.preview, let url = URL(string: preview) {
                                    Link(destination: url) { Label("预览 #\(pr.number)", systemImage: "safari") }
                                }
                                // 构建服务只编 binOS 自己的仓库；显示这个 PR 最新提交的构建结果
                                if session.project == "binos", pr.state == nil || pr.state == "open", let state = BuildsStore.shared.prState(pr.number) {
                                    Button { AppRouter.shared.code = .builds(ref: "pr/\(pr.number)") } label: {
                                        Label("#\(pr.number) \(state.label)", systemImage: state == .failed ? "xmark.octagon" : state == .running ? "hammer" : "checkmark.seal")
                                    }
                                }
                            }
                        }
                    }
                    Section {
                        Text("\(Agents.name(session.agent)) · \(session.turns) 轮 · \(store.projectName(session.project))")
                    }
                } label: {
                    Image(systemName: "ellipsis")
                }
            }
        }
    }

    private func send(_ text: String, _ files: [PendingFile], _ mode: SendMode) async -> Bool {
        notice = nil
        do {
            var attachments: [Upload] = []
            for file in files {
                attachments.append(try await CodeAPI.upload(data: file.data, name: file.name))
            }
            let body = CodeAPI.MessageBody(
                project: currentProject, text: text, attachments: attachments,
                interrupt: mode == .interrupt ? true : nil, queue: mode == .queue ? true : nil,
                agent: choice.agent, model: choice.model, effort: choice.effort)
            let sent = try await CodeAPI.send(sessionId: sessionId, body: body)
            if sessionId == nil {
                createdThread = sent.kitaSession
                onCreated(sent.id, sent.kitaSession)
            }
            await store.refreshSession(sent.id)
            return true
        } catch {
            notice = error.localizedDescription
            return false
        }
    }
}

// 对话的滚动区：新内容到来时贴着底部，往上翻看时出现回到底部的按钮；离顶部不远时往前补读更早的轮
struct TranscriptScroll: View {
    let stream: KitaSessionStream
    let notice: String?
    // 从搜索结果跳过来时定位到的事件的 seq
    var targetSeq: Int?
    @State private var turns: [TranscriptTurn]
    @State private var position = ScrollPosition(edge: .bottom)
    @State private var atBottom = true
    @State private var nearTop = false
    @State private var located = false

    // 补读更早的轮时，离顶部还有这么远就开始读
    private static let olderMargin: CGFloat = 1500

    // 第一次排版就带着内容，初始位置才落在底部
    init(stream: KitaSessionStream, notice: String?, targetSeq: Int? = nil) {
        self.stream = stream
        self.notice = notice
        self.targetSeq = targetSeq
        _turns = State(initialValue: TranscriptTurn.split(stream.events))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                TranscriptView(stream: stream, turns: turns)
                if let notice {
                    Label(notice, systemImage: "exclamationmark.triangle.fill")
                        .font(.footnote)
                        .foregroundStyle(.red)
                }
            }
            .padding(.horizontal)
            .padding(.vertical, 12)
            .frame(maxWidth: 820)
            .containerRelativeFrame(.horizontal)
        }
        .scrollPosition($position)
        .defaultScrollAnchor(.bottom, for: .initialOffset)
        // 前面补上更早的轮时按底部对齐，正在看的内容不动
        .defaultScrollAnchor(atBottom || stream.prepending ? .bottom : nil, for: .sizeChanges)
        .scrollDismissesKeyboard(.interactively)
        .onScrollGeometryChange(for: [Bool].self) { geometry in
            [geometry.visibleRect.maxY >= geometry.contentSize.height - 80, geometry.visibleRect.minY < Self.olderMargin]
        } action: { _, value in
            atBottom = value[0]
            nearTop = value[1]
        }
        .overlay(alignment: .bottomTrailing) {
            if !atBottom {
                Button {
                    withAnimation { position.scrollTo(edge: .bottom) }
                } label: {
                    Image(systemName: "arrow.down")
                        .font(.body.weight(.semibold))
                        .frame(width: 40, height: 40)
                }
                .buttonStyle(.glass)
                .clipShape(.circle)
                .padding()
                .accessibilityLabel("回到底部")
            }
        }
        .task(id: "\(nearTop)-\(stream.firstSeq ?? 0)") {
            if nearTop, located || targetSeq == nil { await stream.loadOlder() }
        }
        .onChange(of: stream.revision, initial: true) {
            turns = TranscriptTurn.split(stream.events, previous: turns)
            locate()
        }
    }

    // 目标在已读到的事件之前时先补读到它，再滚过去
    private func locate() {
        guard let targetSeq, !located else { return }
        if let first = stream.firstSeq, targetSeq < first {
            Task { await stream.loadOlder(until: targetSeq) }
            return
        }
        located = true
        guard let turn = turns.last(where: { $0.first.seq <= targetSeq }) else { return }
        atBottom = false
        Task {
            try? await Task.sleep(for: .milliseconds(300))
            position.scrollTo(id: turn.id, anchor: .top)
            try? await Task.sleep(for: .milliseconds(300))
            withAnimation { position.scrollTo(id: "\(targetSeq)", anchor: .center) }
        }
    }
}
