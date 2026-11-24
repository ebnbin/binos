import { expect, it } from 'vitest'
import { needsDeploy } from './units.ts'

// 漏判了的改动不会上线，平时很难发现
it('按改动的文件判断两端要不要重新上线', () => {
  expect(needsDeploy('web', ['web/src/main.tsx'])).toBe(true)
  expect(needsDeploy('server', ['web/src/main.tsx'])).toBe(false)
  expect(needsDeploy('web', ['server/src/api.ts', 'ios/binOS/RootView.swift'])).toBe(false)
  expect(needsDeploy('server', ['server/src/api.ts'])).toBe(true)
  for (const file of ['protocol/src/index.ts', 'pnpm-lock.yaml', 'package.json', 'tsconfig.base.json']) {
    expect([needsDeploy('server', [file]), needsDeploy('web', [file])]).toEqual([true, true])
  }
  expect(needsDeploy('web', ['design/logo.svg'])).toBe(true)
  expect(needsDeploy('server', ['ios/binOS/RootView.swift'])).toBe(false)
  expect([needsDeploy('server', undefined), needsDeploy('web', undefined)]).toEqual([true, true])
  expect([needsDeploy('server', []), needsDeploy('web', [])]).toEqual([false, false])
})
