import { Hono } from 'hono'
import { expect, it } from 'vitest'
import { isCrossSite } from './websocket-origin.js'

const app = new Hono().get('/', (c) => c.text(String(isCrossSite(c))))
const check = async (origin?: string) => (await app.request('/', { headers: { host: 'binos.app', ...(origin !== undefined && { origin }) } })).text()

it('不带 Origin 的原生客户端放行，带 Origin 的必须同源', async () => {
  expect(await check()).toBe('false')
  expect(await check('https://binos.app')).toBe('false')
  expect(await check('https://evil.example')).toBe('true')
  expect(await check('null')).toBe('true')
  expect(await check('chrome-extension://binos.app')).toBe('true')
})
