import { expect, it } from 'vitest'
import { keyCode } from './keys.js'

it('功能键、标点和小键盘都有键码，按物理键位不受输入法和 Shift 影响', () => {
  expect(keyCode('F5', 'F5')).toBe(116)
  expect(keyCode('F12', '')).toBe(123)
  expect(keyCode('!', 'Digit1')).toBe(49)
  expect(keyCode(':', 'Semicolon')).toBe(186)
  expect(keyCode('7', 'Numpad7')).toBe(103)
  expect(keyCode('Shift', 'ShiftLeft')).toBe(16)
  expect(keyCode('Dead', 'Unidentified')).toBe(0)
})
