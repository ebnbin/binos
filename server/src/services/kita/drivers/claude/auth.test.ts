import { describe, expect, it } from 'vitest'
import { chooseAuth, claudeAttention } from './auth.js'

const hour = 3600_000
const now = Date.parse('2026-10-20T00:00:00Z')
const login = (refreshTokenExpiresAt: number) => ({ accessToken: 'a', refreshToken: 'r', refreshTokenExpiresAt })
const token = { token: 't', expiresAt: now + 300 * 24 * hour }

describe('chooseAuth', () => {
  it('完整登录离过期还远时用它', () => {
    expect(chooseAuth(login(now + 10 * 24 * hour), token, false, now).mode).toBe('login')
  })

  it('完整登录快过期、过期或失效时换成备用 token', () => {
    expect(chooseAuth(login(now + hour), token, false, now).mode).toBe('token')
    expect(chooseAuth(login(now - hour), token, false, now).mode).toBe('token')
    expect(chooseAuth(login(now + 10 * 24 * hour), token, true, now).mode).toBe('token')
    expect(chooseAuth(undefined, token, false, now).mode).toBe('token')
  })

  it('没有能用的备用 token 时，快过期的完整登录接着用，过期了就都用不了', () => {
    expect(chooseAuth(login(now + hour), undefined, false, now).mode).toBe('login')
    expect(chooseAuth(login(now + hour), { token: 't', expiresAt: now - hour }, false, now).mode).toBe('login')
    expect(chooseAuth(login(now - hour), undefined, false, now).mode).toBe('none')
  })
})

describe('claudeAttention', () => {
  const day = 24 * hour
  it('按登录的状况给出要处理的事，以及下一次会变的时间', () => {
    const expiring = chooseAuth(login(now + 3 * day), token, false, now)
    expect(claudeAttention(expiring, now)).toEqual({ attention: { reason: 'login-expiring', usable: true, expiresAt: new Date(now + 3 * day).toISOString() }, changesAt: now + 3 * day - 6 * hour })
    expect(claudeAttention(chooseAuth(login(now + 10 * day), token, false, now), now)).toEqual({ changesAt: now + 3 * day })
    expect(claudeAttention(chooseAuth(login(now + 10 * day), token, true, now), now).attention).toEqual({ reason: 'login-broken', usable: true })
    expect(claudeAttention(chooseAuth(undefined, undefined, false, now), now).attention).toEqual({ reason: 'logged-out', usable: false })
  })
})
