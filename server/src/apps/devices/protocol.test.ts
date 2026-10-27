import { describe, expect, it } from 'vitest'
import { parseRequest } from './protocol.js'

describe('设备请求校验', () => {
  it('拒绝重复平台、无效身份、未知维护操作和无界命令', () => {
    expect(() => parseRequest({ action: 'acquire', owner: 'a', reason: '', platforms: ['ios', 'ios'] })).toThrow('平台必须')
    expect(() => parseRequest({ action: 'release', owner: '', lease: 'id' })).toThrow('缺少有效')
    expect(() => parseRequest({ action: 'control', device: 'id', operation: 'erase-all' })).toThrow('未知维护操作')
    expect(() => parseRequest({ action: 'run', owner: 'a', lease: 'id', cwd: '/tmp', command: ['echo'], timeout: 999999999 })).toThrow('命令超时范围')
    expect(() => parseRequest({ action: 'run', owner: 'a', lease: 'id', cwd: '/tmp', command: [null], timeout: 1000 })).toThrow('无效命令')
    expect(() => parseRequest({ action: 'screenshot', device: 'id', owner: 'a' })).toThrow('缺少有效')
    expect(() => parseRequest({ action: 'acquire', owner: 'a', reason: '', platforms: ['ios'], models: { android: 'pixel' } })).toThrow('机型必须')
  })
})
