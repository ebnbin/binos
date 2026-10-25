// 按键对应的 Windows 虚拟键码（CDP 的 windowsVirtualKeyCode，网页里的 keyCode）。先按物理键位（code）查，
// 没有 code 时按键名（key）查，都没有的单个字符按它的大写字母
const byKey: Record<string, number> = {
  Backspace: 8, Tab: 9, Enter: 13, Shift: 16, Control: 17, Alt: 18, Pause: 19, CapsLock: 20, Escape: 27, ' ': 32,
  PageUp: 33, PageDown: 34, End: 35, Home: 36, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40,
  PrintScreen: 44, Insert: 45, Delete: 46, Meta: 91, ContextMenu: 93, NumLock: 144, ScrollLock: 145,
  ';': 186, '=': 187, ',': 188, '-': 189, '.': 190, '/': 191, '`': 192, '[': 219, '\\': 220, ']': 221, "'": 222,
  ...Object.fromEntries(Array.from({ length: 24 }, (_, i) => [`F${i + 1}`, 112 + i])),
}

const byCode: Record<string, number> = {
  ...Object.fromEntries(['Backspace', 'Tab', 'Enter', 'CapsLock', 'Escape', 'PageUp', 'PageDown', 'End', 'Home', 'ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'PrintScreen', 'Insert', 'Delete', 'ContextMenu', 'NumLock', 'ScrollLock', 'Pause'].map((code) => [code, byKey[code]])),
  Space: 32, ShiftLeft: 16, ShiftRight: 16, ControlLeft: 17, ControlRight: 17, AltLeft: 18, AltRight: 18, MetaLeft: 91, MetaRight: 92,
  Semicolon: 186, Equal: 187, Comma: 188, Minus: 189, Period: 190, Slash: 191, Backquote: 192, BracketLeft: 219, Backslash: 220, BracketRight: 221, Quote: 222, IntlBackslash: 226,
  NumpadMultiply: 106, NumpadAdd: 107, NumpadSubtract: 109, NumpadDecimal: 110, NumpadDivide: 111, NumpadEnter: 13,
  ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`Digit${i}`, 48 + i])),
  ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`Numpad${i}`, 96 + i])),
  ...Object.fromEntries(Array.from({ length: 26 }, (_, i) => [`Key${String.fromCharCode(65 + i)}`, 65 + i])),
  ...Object.fromEntries(Array.from({ length: 24 }, (_, i) => [`F${i + 1}`, 112 + i])),
}

export function keyCode(key: string, code: string): number {
  return byCode[code] ?? byKey[key] ?? (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0)
}
