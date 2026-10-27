import SwiftUI

// 简化的 Markdown：块级结构自己解析，行内交给系统的 AttributedString；公式按原文等宽显示
enum MarkdownBlock: Hashable {
    case heading(level: Int, text: String)
    case paragraph(String)
    case code(language: String, code: String)
    case math(String)
    case list([ListItem])
    case quote(String)
    case table([[String]])
    case image(alt: String, source: String)
    case rule

    struct ListItem: Hashable {
        let depth: Int
        let marker: String
        let text: String
    }

    static func parse(_ text: String) -> [MarkdownBlock] {
        let lines = text.components(separatedBy: "\n")
        var blocks: [MarkdownBlock] = []
        var paragraph: [String] = []
        var i = 0
        func flushParagraph() {
            if !paragraph.isEmpty {
                blocks.append(.paragraph(paragraph.joined(separator: "\n")))
                paragraph = []
            }
        }
        while i < lines.count {
            let line = lines[i]
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if let fence = ["```", "~~~"].first(where: { trimmed.hasPrefix($0) }) {
                flushParagraph()
                let language = String(trimmed.dropFirst(3)).trimmingCharacters(in: .whitespaces)
                var code: [String] = []
                i += 1
                while i < lines.count, !lines[i].trimmingCharacters(in: .whitespaces).hasPrefix(fence) {
                    code.append(lines[i])
                    i += 1
                }
                blocks.append(.code(language: language, code: code.joined(separator: "\n")))
                i += 1
                continue
            }
            if trimmed.hasPrefix("$$") {
                flushParagraph()
                var math = [String(trimmed.dropFirst(2))]
                if trimmed.count > 2, trimmed.hasSuffix("$$") {
                    blocks.append(.math(String(trimmed.dropFirst(2).dropLast(2))))
                    i += 1
                    continue
                }
                i += 1
                while i < lines.count, !lines[i].contains("$$") {
                    math.append(lines[i])
                    i += 1
                }
                if i < lines.count { math.append(lines[i].replacing("$$", with: "")) }
                blocks.append(.math(math.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)))
                i += 1
                continue
            }
            if trimmed.isEmpty {
                flushParagraph()
                i += 1
                continue
            }
            if let match = trimmed.wholeMatch(of: /(#{1,6})\s+(.*)/) {
                flushParagraph()
                blocks.append(.heading(level: match.1.count, text: String(match.2)))
                i += 1
                continue
            }
            if trimmed.wholeMatch(of: /([-*_])(\s*\1){2,}/) != nil {
                flushParagraph()
                blocks.append(.rule)
                i += 1
                continue
            }
            if let match = trimmed.wholeMatch(of: /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/) {
                flushParagraph()
                blocks.append(.image(alt: String(match.1), source: String(match.2)))
                i += 1
                continue
            }
            if trimmed.hasPrefix(">") {
                flushParagraph()
                var quote: [String] = []
                while i < lines.count, lines[i].trimmingCharacters(in: .whitespaces).hasPrefix(">") {
                    quote.append(String(lines[i].trimmingCharacters(in: .whitespaces).dropFirst()).trimmingCharacters(in: .whitespaces))
                    i += 1
                }
                blocks.append(.quote(quote.joined(separator: "\n")))
                continue
            }
            if trimmed.hasPrefix("|"), i + 1 < lines.count, lines[i + 1].trimmingCharacters(in: .whitespaces).wholeMatch(of: /\|?(\s*:?-+:?\s*\|)+\s*:?-*:?\s*\|?/) != nil {
                flushParagraph()
                var rows: [[String]] = [cells(line)]
                i += 2
                while i < lines.count, lines[i].trimmingCharacters(in: .whitespaces).hasPrefix("|") {
                    rows.append(cells(lines[i]))
                    i += 1
                }
                blocks.append(.table(rows))
                continue
            }
            if listItem(line) != nil {
                flushParagraph()
                var items: [ListItem] = []
                while i < lines.count {
                    if let item = listItem(lines[i]) {
                        items.append(item)
                    } else if !lines[i].trimmingCharacters(in: .whitespaces).isEmpty, lines[i].hasPrefix("  "), let last = items.popLast() {
                        // 缩进的续行接在上一项后面
                        items.append(ListItem(depth: last.depth, marker: last.marker, text: last.text + "\n" + lines[i].trimmingCharacters(in: .whitespaces)))
                    } else {
                        break
                    }
                    i += 1
                }
                blocks.append(.list(items))
                continue
            }
            paragraph.append(line)
            i += 1
        }
        flushParagraph()
        return blocks
    }

    private static func listItem(_ line: String) -> ListItem? {
        guard let match = line.wholeMatch(of: /(\s*)([-*+]|\d+[.)])\s+(.*)/) else { return nil }
        let marker = String(match.2)
        var text = String(match.3)
        var bullet = marker.first?.isNumber == true ? marker : "•"
        if text.hasPrefix("[ ] ") { bullet = "☐"; text.removeFirst(4) }
        if text.hasPrefix("[x] ") || text.hasPrefix("[X] ") { bullet = "☑"; text.removeFirst(4) }
        return ListItem(depth: match.1.count / 2, marker: bullet, text: text)
    }

    private static func cells(_ line: String) -> [String] {
        var row = line.trimmingCharacters(in: .whitespaces)
        if row.hasPrefix("|") { row.removeFirst() }
        if row.hasSuffix("|") { row.removeLast() }
        return row.components(separatedBy: "|").map { $0.trimmingCharacters(in: .whitespaces) }
    }
}

enum Inline {
    // 行内的 Markdown：粗体、斜体、行内代码、链接；解析失败时原样显示
    static func attributed(_ text: String) -> AttributedString {
        var result = (try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace, failurePolicy: .returnPartiallyParsedIfPossible))) ?? AttributedString(text)
        for run in result.runs where run.inlinePresentationIntent?.contains(.code) == true {
            result[run.range].font = .system(.callout, design: .monospaced)
            result[run.range].backgroundColor = Color.secondary.opacity(0.12)
        }
        return result
    }
}

struct MarkdownView: View {
    let text: String
    // 回复里引用的本机文件（原样的路径）对应的会话文件快照
    var files: [String: String] = [:]
    var thread: String?

    var body: some View {
        let blocks = MarkdownBlock.parse(text)
        VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                BlockView(block: block, files: files, thread: thread)
            }
        }
        .environment(\.openURL, OpenURLAction { url in
            guard url.scheme == nil || url.scheme == "file", let thread else { return .systemAction }
            let path = url.path(percentEncoded: false)
            if let file = files[path] ?? files[url.absoluteString] {
                FilePresenter.shared.present(url: CodeAPI.sessionFileURL(thread: thread, file: file), name: (path as NSString).lastPathComponent)
                return .handled
            }
            return .discarded
        })
    }
}

private struct BlockView: View {
    let block: MarkdownBlock
    let files: [String: String]
    let thread: String?

    var body: some View {
        switch block {
        case .heading(let level, let text):
            Text(Inline.attributed(text))
                .font(level == 1 ? .title2 : level == 2 ? .title3 : .headline)
                .bold()
                .padding(.top, 4)
        case .paragraph(let text):
            Text(Inline.attributed(text))
                .textSelection(.enabled)
        case .code(let language, let code):
            CodeBlock(code: code, language: language)
        case .math(let text):
            Text(text)
                .font(.system(.callout, design: .serif))
                .italic()
                .frame(maxWidth: .infinity)
                .padding(8)
                .textSelection(.enabled)
        case .list(let items):
            VStack(alignment: .leading, spacing: 4) {
                ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(item.marker).foregroundStyle(.secondary).monospacedDigit()
                        Text(Inline.attributed(item.text)).textSelection(.enabled)
                    }
                    .padding(.leading, CGFloat(item.depth) * 16)
                }
            }
        case .quote(let text):
            Text(Inline.attributed(text))
                .foregroundStyle(.secondary)
                .padding(.leading, 10)
                .overlay(alignment: .leading) {
                    Rectangle().fill(.quaternary).frame(width: 3)
                }
        case .table(let rows):
            ScrollView(.horizontal) {
                Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 6) {
                    ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                        GridRow {
                            ForEach(Array(row.enumerated()), id: \.offset) { _, cell in
                                Text(Inline.attributed(cell))
                                    .font(.callout)
                                    .fontWeight(index == 0 ? .semibold : .regular)
                            }
                        }
                        if index == 0 { Divider() }
                    }
                }
                .padding(10)
            }
            .background(.quaternary.opacity(0.4), in: .rect(cornerRadius: 8))
        case .image(let alt, let source):
            if let url = imageURL(source) {
                RemoteImage(url: url)
                    .frame(maxWidth: .infinity, maxHeight: 320, alignment: .leading)
                    .accessibilityLabel(alt)
            } else {
                Text(alt.isEmpty ? source : alt).foregroundStyle(.secondary)
            }
        case .rule:
            Divider()
        }
    }

    private func imageURL(_ source: String) -> URL? {
        if let thread, let file = files[source] { return CodeAPI.sessionFileURL(thread: thread, file: file) }
        if source.hasPrefix("https://") || source.hasPrefix("http://") { return URL(string: source) }
        return nil
    }
}

struct CodeBlock: View {
    let code: String
    var language = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(language.isEmpty ? "代码" : language)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                CopyButton(text: code)
            }
            .padding(.horizontal, 10)
            .padding(.top, 6)
            ScrollView(.horizontal) {
                Text(Highlighter.highlight(code))
                    .font(.system(.footnote, design: .monospaced))
                    .textSelection(.enabled)
                    .padding(10)
            }
        }
        .background(Color(.secondarySystemBackground), in: .rect(cornerRadius: 10))
    }
}

struct CopyButton: View {
    let text: String
    @State private var copied = false

    var body: some View {
        Button {
            UIPasteboard.general.string = text
            copied = true
            Task {
                try? await Task.sleep(for: .seconds(1.5))
                copied = false
            }
        } label: {
            Image(systemName: copied ? "checkmark" : "doc.on.doc")
                .font(.caption)
                .contentTransition(.symbolEffect(.replace))
        }
        .buttonStyle(.borderless)
        .accessibilityLabel("复制")
    }
}

// 不分语言的简单高亮：注释、字符串、数字、常见关键字
enum Highlighter {
    private static let keywords: Set<String> = [
        "func", "let", "var", "if", "else", "for", "while", "return", "import", "export", "from", "const", "function", "class", "struct", "enum",
        "case", "switch", "default", "break", "continue", "true", "false", "nil", "null", "undefined", "async", "await", "try", "catch", "throw",
        "new", "this", "self", "type", "interface", "public", "private", "static", "def", "in", "of", "do", "fn", "pub", "use", "mut", "impl",
        "package", "go", "range", "select", "then", "fi", "elif", "esac", "echo", "None", "True", "False", "and", "or", "not", "with", "as",
    ]
    private static let token = /(\/\/[^\n]*|#(?![!\[{])[^\n]*|\/\*[\s\S]*?\*\/)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|(\b[A-Za-z_]\w*\b)/

    static func highlight(_ code: String) -> AttributedString {
        guard code.count < 30_000 else { return AttributedString(code) }
        var result = AttributedString()
        var cursor = code.startIndex
        for match in code.matches(of: token) {
            result += AttributedString(code[cursor..<match.range.lowerBound])
            var piece = AttributedString(code[match.range])
            if match.1 != nil {
                piece.foregroundColor = .secondary
            } else if match.2 != nil {
                piece.foregroundColor = .orange
            } else if match.3 != nil {
                piece.foregroundColor = .purple
            } else if let word = match.4, keywords.contains(String(word)) {
                piece.foregroundColor = .pink
            }
            result += piece
            cursor = match.range.upperBound
        }
        result += AttributedString(code[cursor...])
        return result
    }
}
