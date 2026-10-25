import SwiftUI

// 一次工具调用：一行摘要，点开看参数、改动和结果
struct ToolCallView: View {
    let state: CallState
    let context: TranscriptContext
    @State private var expanded = false

    var body: some View {
        let label = ToolLabel(state.call)
        VStack(alignment: .leading, spacing: 6) {
            Button {
                withAnimation(.snappy) { expanded.toggle() }
            } label: {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Image(systemName: label.icon)
                        .frame(width: 16)
                        .foregroundStyle(.secondary)
                    Text(label.verb)
                        .foregroundStyle(.secondary)
                        .fixedSize()
                    if let detail = label.detail {
                        Text(detail)
                            .font(.footnote.monospaced())
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                    Spacer(minLength: 4)
                    if case .edit(_, let change?) = state.call.tool {
                        let counts = Diff.counts(for: change)
                        Text("+\(counts.added)").foregroundStyle(.green)
                        Text("−\(counts.removed)").foregroundStyle(.red)
                    }
                    CallStatusIcon(state: state)
                }
                .font(.footnote)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            if expanded {
                ToolBody(state: state, context: context)
                    .padding(.leading, 22)
            }
        }
    }
}

struct CallStatusIcon: View {
    let state: CallState

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { timeline in
            HStack(spacing: 4) {
                if let duration = state.duration(now: timeline.date), duration >= 1 {
                    Text(Format.duration(duration))
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(.tertiary)
                }
                switch state.status {
                case .running: ProgressView().controlSize(.mini)
                case .done: Image(systemName: "checkmark").foregroundStyle(.tertiary)
                case .error: Image(systemName: "xmark.circle.fill").foregroundStyle(.red)
                case .stopped: Image(systemName: "stop.circle").foregroundStyle(.tertiary)
                }
            }
            .font(.caption)
        }
    }
}

// 发给页面时省略过的调用，展开时读完整的；还没读到或读不到时用已有的。结果是读完之后才到的，就还用已有的
private struct FullCall: ViewModifier {
    let thread: String
    let state: CallState
    @Binding var shown: CallState

    @State private var full: (for: ToolResultEntry?, state: CallState)?

    func body(content: Content) -> some View {
        content
            .onChange(of: state, initial: true) {
                shown = full.flatMap { $0.for == state.result ? $0.state : nil } ?? state
            }
            .task(id: state.result) {
                guard state.call.clipped || state.result?.clipped == true,
                      let loaded = await KitaSessionStream.fullCall(thread: thread, index: state.index) else { return }
                let value = CallState(index: state.index, call: loaded.call, result: loaded.result ?? state.result, live: state.live)
                full = (state.result, value)
                shown = value
            }
    }
}

private struct ToolBody: View {
    let state: CallState
    let context: TranscriptContext
    @State private var shown: CallState

    init(state: CallState, context: TranscriptContext) {
        self.state = state
        self.context = context
        _shown = State(initialValue: state)
    }

    var body: some View {
        let state = shown
        VStack(alignment: .leading, spacing: 8) {
            switch state.call.tool {
            case .command(let command):
                CodeBlock(code: command, language: "shell")
            case .edit(_, let change?):
                DiffView(lines: Diff.lines(for: change), limit: 400)
            case .webFetch(_, let prompt?):
                Text(prompt).font(.footnote).foregroundStyle(.secondary)
            default:
                if let input = state.call.input, needsInput {
                    CodeBlock(code: input.prettyText, language: "json")
                }
            }
            if let result = state.result {
                if !result.images.isEmpty {
                    ScrollView(.horizontal) {
                        HStack {
                            ForEach(result.images, id: \.self) { image in
                                Button {
                                    FilePresenter.shared.present(url: CodeAPI.sessionFileURL(thread: context.thread, file: image), name: image)
                                } label: {
                                    RemoteImage(url: CodeAPI.sessionFileURL(thread: context.thread, file: image))
                                        .frame(maxHeight: 200)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
                if let output = result.output, !output.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        if result.truncated || result.clipped {
                            Text("前面的输出已省略").font(.caption2).foregroundStyle(.tertiary)
                        }
                        ScrollView([.horizontal, .vertical]) {
                            Text(output.count > 20_000 ? String(output.suffix(20_000)) : output)
                                .font(.system(.caption, design: .monospaced))
                                .foregroundStyle(result.status == "error" ? .red : .primary)
                                .textSelection(.enabled)
                                .padding(8)
                        }
                        .frame(maxHeight: 280)
                        .background(Color(.secondarySystemBackground), in: .rect(cornerRadius: 8))
                    }
                }
            }
        }
        .modifier(FullCall(thread: context.thread, state: self.state, shown: $shown))
    }

    // 摘要显示不全时带着原始参数
    private var needsInput: Bool {
        switch shown.call.tool {
        case .mcp, .browser, .other, .edit, .todo, .skill: true
        default: false
        }
    }
}

// 子 agent：说明、进度，点开看它的提示词、过程和结果
struct SubagentView: View {
    let state: CallState
    let context: TranscriptContext
    @State private var expanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button {
                withAnimation(.snappy) { expanded.toggle() }
            } label: {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Image(systemName: "person.2").foregroundStyle(.secondary)
                        Text(title).lineLimit(2)
                        Spacer(minLength: 4)
                        CallStatusIcon(state: state)
                    }
                    if let progress = context.live?.tasks[state.call.id], state.status == .running {
                        Text(progressText(progress))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
                .font(.footnote)
                .padding(10)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            if expanded {
                VStack(alignment: .leading, spacing: 12) {
                    if case .subagent(_, let prompt?, _) = state.call.tool {
                        DisclosureGroup("提示词") {
                            Text(prompt).font(.footnote).textSelection(.enabled)
                        }
                        .font(.footnote)
                    }
                    let children = context.index.children[state.index] ?? []
                    if !children.isEmpty {
                        let blocks = context.index.blocks(children, live: state.live)
                        ForEach(blocks) { block in
                            SubagentBlock(block: block, context: context)
                        }
                    }
                    if children.isEmpty, state.result?.output?.isEmpty == false {
                        Divider()
                        SubagentResult(state: state, context: context)
                    }
                }
                .padding([.horizontal, .bottom], 10)
            }
        }
        .background(Color(.secondarySystemBackground).opacity(0.6), in: .rect(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(.quaternary))
    }

    private var title: String {
        if case .subagent(let description, _, let type) = state.call.tool {
            return [type, description].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
        }
        return state.call.name
    }

    private func progressText(_ progress: TaskProgress) -> String {
        var parts: [String] = []
        if let activity = progress.activity { parts.append(activity) }
        if let uses = progress.toolUses { parts.append("\(uses) 次工具") }
        if let tokens = progress.tokens { parts.append("\(Format.tokens(tokens)) token") }
        return parts.joined(separator: " · ")
    }
}

// 没有过程的记录时交回的结果，发给页面时省略过就读完整的
private struct SubagentResult: View {
    let state: CallState
    let context: TranscriptContext
    @State private var shown: CallState

    init(state: CallState, context: TranscriptContext) {
        self.state = state
        self.context = context
        _shown = State(initialValue: state)
    }

    var body: some View {
        MarkdownView(text: shown.result?.output ?? "")
            .font(.footnote)
            .modifier(FullCall(thread: context.thread, state: state, shown: $shown))
    }
}

// 子 agent 的过程不分轮，只有文字和步骤
private struct SubagentBlock: View {
    let block: Block
    let context: TranscriptContext

    var body: some View {
        switch block {
        case .text(_, let text, let files):
            MarkdownView(text: text, files: files, thread: context.thread).font(.footnote)
        case .steps(_, let steps):
            StepsView(steps: steps, context: context, expandedByDefault: false)
        case .divider(_, let text):
            DividerLabel(text: text)
        default:
            EmptyView()
        }
    }
}
