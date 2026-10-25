import { expect, it } from 'vitest'
import { parseRequest } from './protocol.js'
it('拒绝任意 git 引用、参数和路径，只接受明确的构建来源', () => {
  for (const ref of ['--upload-pack=evil', '../main', 'HEAD', 'pr/0', 'pr/1;echo x', 'a'.repeat(39)]) expect(() => parseRequest({ action: 'enqueue', ref, targets: ['android'] })).toThrow('请求参数无效')
  expect(parseRequest({ action: 'enqueue', ref: 'pr/12', targets: ['android', 'android', 'ios'] })).toEqual({ action: 'enqueue', ref: 'pr/12', targets: ['android', 'ios'] })
  expect(() => parseRequest({ action: 'enqueue', ref: 'main', targets: ['shell'] })).toThrow('请求参数无效')
  expect(() => parseRequest({ action: 'settings', automatic: 1 })).toThrow('请求参数无效')
})
