import type { SystemSnapshot } from '../src/apps/system/types.js'
export function snapshot(at = Date.now()): SystemSnapshot {
  return {
    at,
    host: { name: 'test-mac', model: 'Mac-test', chip: 'Test CPU', os: 'macOS', uptime: 600, cores: 8 },
    cpu: { percent: 10 },
    memory: { total: 64 * 1024 ** 3, free: 1024 ** 3, cached: 30 * 1024 ** 3, pressure: 'normal' },
    volumes: [],
    network: { receiveRate: null, sendRate: null },
    power: { source: 'AC Power', battery: null },
    runtime: { version: 'test', uptime: 100, memory: 1000, test: true },
    unavailable: [],
  }
}
