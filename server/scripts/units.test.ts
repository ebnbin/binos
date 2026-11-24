import { expect, it } from 'vitest'
import { needsDeploy } from './units.ts'

// 漏判了的改动不会上线，平时很难发现
it('按改动的文件判断两端要不要重新上线', () => {
  expect(needsDeploy('web', ['web/src/main.tsx'])).toBe(true)
  expect(needsDeploy('server', ['web/src/main.tsx'])).toBe(false)
  expect(needsDeploy('web', ['server/src/api.ts', 'ios/binOS/RootView.swift'])).toBe(false)
  expect(needsDeploy('server', ['server/src/api.ts'])).toBe(true)
  expect([needsDeploy('server', ['server/src/contract/index.ts']), needsDeploy('web', ['server/src/contract/index.ts'])]).toEqual([true, false])
  expect([needsDeploy('server', ['web/src/contract.ts']), needsDeploy('web', ['web/src/contract.ts'])]).toEqual([false, true])
  expect([needsDeploy('server', ['server/pnpm-lock.yaml']), needsDeploy('web', ['server/pnpm-lock.yaml'])]).toEqual([true, false])
  expect([needsDeploy('server', ['web/pnpm-lock.yaml']), needsDeploy('web', ['web/pnpm-lock.yaml'])]).toEqual([false, true])
  expect([needsDeploy('server', ['design/logo.svg']), needsDeploy('web', ['design/logo.svg'])]).toEqual([false, true])
  expect(needsDeploy('server', ['ios/binOS/RootView.swift'])).toBe(false)
  expect([needsDeploy('server', undefined), needsDeploy('web', undefined)]).toEqual([true, true])
  expect([needsDeploy('server', []), needsDeploy('web', [])]).toEqual([false, false])
})
