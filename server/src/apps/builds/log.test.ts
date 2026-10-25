import { expect, it } from 'vitest'
import { completeLength } from './log.js'

it('按字节读日志时不在一个字的中间切开', () => {
  const text = Buffer.from('构建a')
  expect(completeLength(text)).toBe(text.length)
  expect(completeLength(text.subarray(0, 2))).toBe(0)
  expect(completeLength(text.subarray(0, 4))).toBe(3)
  expect(completeLength(Buffer.from('😀').subarray(0, 3))).toBe(0)
})
