import SwiftUI

// 远程浏览器按键消息的 modifiers，位的含义和 CDP 的一致
struct KeyModifiers: OptionSet, Hashable {
    let rawValue: Int
    static let alt = KeyModifiers(rawValue: 1)
    static let control = KeyModifiers(rawValue: 2)
    static let meta = KeyModifiers(rawValue: 4)
    static let shift = KeyModifiers(rawValue: 8)

    init(rawValue: Int) { self.rawValue = rawValue }

    init(_ modifiers: EventModifiers) {
        var value: KeyModifiers = []
        if modifiers.contains(.option) { value.insert(.alt) }
        if modifiers.contains(.control) { value.insert(.control) }
        if modifiers.contains(.command) { value.insert(.meta) }
        if modifiers.contains(.shift) { value.insert(.shift) }
        self = value
    }
}

// 发给远程浏览器的一个键：DOM 的 key 和 code；shift 是这个字符本身要按着 Shift
struct RemoteKey: Hashable {
    let key: String
    let code: String
    var shift = false

    private static let punctuation: [Character: String] = [
        " ": "Space", "-": "Minus", "=": "Equal", "[": "BracketLeft", "]": "BracketRight", "\\": "Backslash",
        ";": "Semicolon", "'": "Quote", ",": "Comma", ".": "Period", "/": "Slash", "`": "Backquote",
    ]

    static func character(_ character: Character) -> RemoteKey? {
        guard character.isASCII else { return nil }
        if character.isLetter {
            return RemoteKey(key: String(character), code: "Key\(character.uppercased())", shift: character.isUppercase)
        }
        if character.isNumber { return RemoteKey(key: String(character), code: "Digit\(character)") }
        return punctuation[character].map { RemoteKey(key: String(character), code: $0) }
    }

    // 外接键盘上的功能键
    static func special(_ key: KeyEquivalent) -> RemoteKey? {
        switch key {
        case .escape: named("Escape")
        case .tab: named("Tab")
        case .upArrow: named("ArrowUp")
        case .downArrow: named("ArrowDown")
        case .leftArrow: named("ArrowLeft")
        case .rightArrow: named("ArrowRight")
        case .home: named("Home")
        case .end: named("End")
        case .pageUp: named("PageUp")
        case .pageDown: named("PageDown")
        case .deleteForward: named("Delete")
        default: nil
        }
    }

    private static func named(_ name: String) -> RemoteKey { RemoteKey(key: name, code: name) }

    // 按键栏上的功能键，都是服务端换算得出键码的
    static let bar: [(label: String, key: RemoteKey)] = [
        ("esc", named("Escape")), ("tab", named("Tab")),
        ("arrow.left", named("ArrowLeft")), ("arrow.up", named("ArrowUp")), ("arrow.down", named("ArrowDown")), ("arrow.right", named("ArrowRight")),
        ("home", named("Home")), ("end", named("End")), ("pgup", named("PageUp")), ("pgdn", named("PageDown")), ("del", named("Delete")),
    ]
}

// 软键盘上方的按键栏：修饰键按一下亮起，和下一个键一起发出；功能键直接发
struct KeyBar: View {
    @Binding var modifiers: KeyModifiers
    let send: (RemoteKey) -> Void

    private static let modifierKeys: [(icon: String, name: String, modifier: KeyModifiers)] = [
        ("command", "Command", .meta), ("control", "Control", .control), ("option", "Option", .alt), ("shift", "Shift", .shift),
    ]

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(Self.modifierKeys, id: \.name) { item in
                    let on = modifiers.contains(item.modifier)
                    Button {
                        modifiers.formSymmetricDifference(item.modifier)
                    } label: {
                        Image(systemName: item.icon).frame(minWidth: 24)
                    }
                    .buttonStyle(.bordered)
                    .tint(on ? .accentColor : .secondary)
                    .accessibilityLabel(item.name)
                    .accessibilityAddTraits(on ? .isSelected : [])
                }
                Divider().frame(height: 20)
                ForEach(RemoteKey.bar, id: \.label) { item in
                    Button {
                        send(item.key)
                    } label: {
                        if item.label.hasPrefix("arrow") {
                            Image(systemName: item.label).frame(minWidth: 18)
                        } else {
                            Text(item.label).font(.footnote.monospaced())
                        }
                    }
                    .buttonStyle(.bordered)
                    .tint(.secondary)
                    .accessibilityLabel(item.key.key)
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
        }
    }
}
