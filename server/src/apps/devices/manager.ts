import { randomUUID } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { processStartTime, isRunning } from '../../process.js'
import type { ProcessIdentity } from '../../process.js'
import { build, dataDir, mode, statePath } from './config.js'
import { create, destroy, deviceEnv, discover, displayStates, health, message, models, reset, resolveModels, screenshot } from './platform.js'
import { cancel, event, policy, release, requestLease, requireLease, schedule, transition } from './state.js'
import { emptyState } from './types.js'
import type { Device, LeaseResult, Request, Snapshot, State } from './types.js'

type Job = { generation: string | undefined; abort: AbortController }
type Run = { abort: AbortController; devices: string[] }
export class Manager {
  state: State
  readonly startedAt = Date.now()
  private saved = ''
  private jobs = new Map<string, Job>()
  private busy = new Map<string, Run>()
  // 每台设备按屏幕缓存截图
  private captures = new Map<string, Map<string, { generation?: string; time: number; result: ReturnType<typeof screenshot> }>>()
  private observed: Snapshot['observed'] = []
  private discoveryErrors: string[] = []
  private lastHealth = 0
  private checking = false
  private ticking = false
  private stopping = false
  private runDir = path.join(dataDir, 'runs')

  constructor() {
    mkdirSync(this.runDir, { recursive: true })
    this.state = emptyState()
    if (existsSync(statePath)) {
      const saved = JSON.parse(readFileSync(statePath, 'utf8'))
      if (![1, 2].includes(saved.version) || saved.mode !== mode || !Array.isArray(saved.devices) || !Array.isArray(saved.leases) || !Array.isArray(saved.queue) || !Array.isArray(saved.events)) throw new Error('设备登记簿格式或运行模式不匹配，已停止，未覆盖数据')
      if (saved.version === 1) {
        saved.version = 2
        saved.ended = []
        for (const device of saved.devices) {
          device.generation = randomUUID()
          device.idleSince = Date.now()
          if (device.status === 'maintenance') device.status = 'broken'
        }
        for (const lease of saved.leases) lease.requestId = randomUUID()
        for (const waiting of saved.queue) Object.assign(waiting, { id: randomUUID(), phase: 'waiting', devices: [] })
      }
      this.state = saved
      this.validate()
    }
    if (mode === 'real') {
      const output = execFileSync('sysctl', ['-n', 'kern.boottime'], { encoding: 'utf8', timeout: 5000 })
      const boot = Number(/sec = (\d+)/.exec(output)?.[1]) * 1000
      if (!Number.isFinite(boot)) throw new Error('无法核对系统启动时间')
      if (this.state.bootTime !== undefined && this.state.bootTime !== boot) {
        for (const lease of [...this.state.leases]) release(this.state, lease, Date.now(), '系统重启，原租约已撤销')
        for (const waiting of [...this.state.queue]) cancel(this.state, waiting, Date.now())
        for (const device of this.state.devices) if (device.status === 'free') transition(device, Date.now() - (device.idleSince ?? 0) >= policy.deviceIdle ? 'destroying' : 'cleaning')
      }
      this.state.bootTime = boot
      // 早先设备集里的 iOS 设备闲置时回收，之后按需在默认设备集里新建
      for (const device of this.state.devices) if (device.platform === 'ios' && !device.iosSet && device.status === 'free') transition(device, 'destroying')
    }
    for (const file of readdirSync(this.runDir)) {
      const record = path.join(this.runDir, file)
      const identity = JSON.parse(readFileSync(record, 'utf8')) as ProcessIdentity
      if (isRunning(identity)) {
        try { process.kill(-identity.pid, 'SIGKILL') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error }
        for (let attempt = 0; attempt < 100 && isRunning(identity); attempt++) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20)
        if (isRunning(identity)) throw new Error('遗留设备命令尚未退出，稍后重试启动服务')
      }
      rmSync(record)
    }
    event(this.state, '设备管理服务启动', Date.now())
    this.save()
  }
  private validate() {
    const s = this.state
    const ids = new Set(s.devices.map((device) => device.id))
    const owners = [...s.leases, ...s.queue].map((item) => item.owner)
    const assigned = [...s.leases, ...s.queue].flatMap((item) => item.devices)
    if (!Array.isArray(s.ended) || ids.size !== s.devices.length || new Set(owners).size !== owners.length || new Set(assigned).size !== assigned.length || assigned.some((id) => !ids.has(id)) || s.devices.some((device) => !['android', 'ios'].includes(device.platform) || !['creating', 'checking', 'free', 'reserved', 'leased', 'cleaning', 'destroying', 'broken'].includes(device.status))) throw new Error('设备登记簿关系无效，已停止，未覆盖数据')
  }
  snapshot(): Snapshot {
    return structuredClone({ ...this.state, capacity: policy.capacity, build, mode, pid: process.pid, startedAt: this.startedAt, observed: this.observed, discoveryErrors: this.discoveryErrors })
  }
  private save() {
    const content = JSON.stringify({ ...this.state, mode }) + '\n'
    if (content === this.saved) return
    writeFileSync(`${statePath}.tmp`, content, { mode: 0o600, flush: true })
    renameSync(`${statePath}.tmp`, statePath)
    this.saved = content
  }
  private device(id: string) {
    const device = this.state.devices.find((item) => item.id === id)
    if (!device) throw new Error('受管理设备不存在')
    return device
  }
  private result(owner: string): LeaseResult {
    const lease = this.state.leases.find((item) => item.owner === owner)
    if (lease) {
      if (!lease.claimed) lease.devices.forEach((id) => this.captures.delete(id))
      lease.claimed = true
      for (const id of lease.devices) this.device(id).status = 'leased'
      this.save()
      return { requestId: lease.requestId, lease: structuredClone(lease), env: deviceEnv(lease.devices.map((id) => this.device(id))) }
    }
    const waiting = this.state.queue.find((item) => item.owner === owner)!
    return { requestId: waiting.id, position: this.state.queue.filter((item) => item.phase !== 'failed').findIndex((item) => item.owner === owner) + 1, phase: waiting.phase, error: waiting.error }
  }
  tick() {
    if (this.ticking || this.stopping) return
    this.ticking = true
    try {
      schedule(this.state, Date.now(), new Set(this.busy.keys()))
      this.save()
      for (const device of this.state.devices) {
        const job = this.jobs.get(device.id)
        if (job) { if (job.generation !== device.generation) job.abort.abort(); continue }
        if ([...this.busy.values()].some((run) => run.devices.includes(device.id))) continue
        if (device.status === 'broken' && (device.attempts ?? 0) < 3 && Date.now() >= (device.retryAt ?? 0)) {
          const attempts = device.attempts ?? 0
          transition(device, 'destroying')
          device.attempts = attempts
          this.save()
        }
        if (!['creating', 'checking', 'cleaning', 'destroying'].includes(device.status) || Date.now() < (device.retryAt ?? 0)) continue
        const entry = { generation: device.generation, abort: new AbortController() }
        this.jobs.set(device.id, entry)
        void this.work(device, entry).finally(() => {
          if (this.jobs.get(device.id) === entry) this.jobs.delete(device.id)
          this.tick()
        }).catch((error) => console.error(message(error)))
      }
      if (!this.checking && Date.now() - this.lastHealth > 30_000) {
        this.checking = true
        this.lastHealth = Date.now()
        void this.check().finally(() => { this.checking = false })
      }
    } finally { this.ticking = false }
  }
  private async work(device: Device, job: Job) {
    const operation = device.status === 'creating' ? 'create' : device.status === 'destroying' ? 'destroy' : device.status === 'checking' ? 'check' : 'reset'
    const generation = device.generation
    try {
      let result: Device | undefined
      if (mode === 'mock') {
        if (operation === 'create') result = await create(structuredClone(device))
        else if (operation === 'destroy') await destroy(structuredClone(device))
        else if (operation === 'check') {
          try { await health(structuredClone(device)) } catch { await reset(structuredClone(device)) }
        }
        else await reset(structuredClone(device))
      } else result = await this.worker(device, operation, job.abort.signal)
      if (device.generation !== generation || job.abort.signal.aborted) return
      if (operation === 'destroy') {
        this.state.devices = this.state.devices.filter((item) => item.id !== device.id)
        event(this.state, '设备已销毁，容量已释放', Date.now(), device.id)
      } else {
        if (result) Object.assign(device, { target: result.target, system: result.system, model: result.model, modelName: result.modelName, iosSet: result.iosSet, displays: result.displays })
        transition(device, operation === 'reset' ? 'free' : 'reserved')
        if (operation === 'reset') device.idleSince ??= Date.now()
        delete device.error
        device.checkedAt = Date.now()
        event(this.state, operation === 'create' ? '设备初始化完成' : operation === 'check' ? '设备检查完成' : '设备清理完成', Date.now(), device.id)
      }
    } catch (error) {
      if (device.generation !== generation || job.abort.signal.aborted) return
      device.status = 'broken'
      device.error = message(error)
      device.attempts = (device.attempts ?? 0) + 1
      device.retryAt = Date.now() + device.attempts * 10_000
      event(this.state, `${operation === 'destroy' ? '销毁' : '准备或清理'}失败：${device.error}`, Date.now(), device.id)
    }
    this.captures.delete(device.id)
    this.save()
  }
  private worker(device: Device, operation: string, signal: AbortSignal) {
    const record = path.join(this.runDir, `device-${device.id}.json`)
    return new Promise<Device | undefined>((resolve, reject) => {
      const entry = path.join(import.meta.dirname, `worker${path.extname(import.meta.filename)}`)
      const child = spawn(process.execPath, [...process.execArgv, entry], { env: process.env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] })
      let errors = '', output = ''
      const kill = () => { if (child.pid) { try { process.kill(-child.pid, 'SIGKILL') } catch { /* 已退出。 */ } } }
      const timer = setTimeout(kill, 10 * 60_000)
      signal.addEventListener('abort', kill, { once: true })
      if (signal.aborted) kill()
      child.stdin.on('error', () => {})
      child.stderr.on('data', (chunk: Buffer) => { errors = (errors + chunk.toString()).slice(-1200) })
      child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); if (output.length > 64 * 1024) kill() })
      const done = () => { clearTimeout(timer); signal.removeEventListener('abort', kill); rmSync(record, { force: true }) }
      child.on('error', (error) => { done(); reject(error) })
      child.on('close', (code) => {
        done()
        if (code !== 0 || signal.aborted) reject(new Error(errors.trim() || '设备操作退出、取消或超时'))
        else {
          try { resolve(operation === 'create' ? JSON.parse(output) as Device : undefined) } catch (error) { reject(error) }
        }
      })
      if (child.pid) {
        const startedAt = processStartTime(child.pid)
        if (startedAt) {
          try {
            writeFileSync(record, JSON.stringify({ pid: child.pid, startedAt }), { mode: 0o600, flush: true })
            child.stdin.end(JSON.stringify({ operation, device }))
          } catch (error) { errors = message(error); kill() }
        } else kill()
      }
    })
  }
  private async check() {
    try {
      for (const device of [...this.state.devices].filter((item) => ['free', 'reserved', 'leased'].includes(item.status))) {
        const generation = device.generation, status = device.status
        try {
          await health(device)
          if (device.generation === generation && device.status === status) delete device.error
        } catch (error) {
          if (device.generation !== generation || device.status !== status) continue
          device.error = message(error)
          if (status !== 'leased') device.status = 'broken'
          event(this.state, `健康检查失败：${device.error}`, Date.now(), device.id)
        }
        device.checkedAt = Date.now()
      }
      this.save()
    } catch (error) { console.error(message(error)) }
  }
  async handle(request: Request): Promise<unknown> {
    if (this.stopping) throw new Error('设备服务正在停止，请稍后重试')
    if (request.action !== 'status' && request.action !== 'stop') this.tick()
    const now = Date.now()
    switch (request.action) {
      case 'status': return this.snapshot()
      case 'discover': {
        const result = await discover()
        this.observed = result.observed.filter((item) => !this.state.devices.some((device) => device.target === item.target))
        this.discoveryErrors = result.discoveryErrors
        return this.snapshot()
      }
      case 'models': return models()
      case 'acquire': {
        const resolved = request.models && Object.keys(request.models).length ? await resolveModels(request.models) : undefined
        requestLease(this.state, request.owner, request.reason, request.platforms, now, request.requestId, resolved)
        this.tick()
        return this.result(request.owner)
      }
      case 'renew': {
        const lease = requireLease(this.state, request.owner, request.lease)
        lease.lastSeen = now
        this.save()
        return this.result(request.owner)
      }
      case 'release': {
        const lease = this.state.leases.find((item) => item.id === request.lease && item.owner === request.owner)
        if (!lease) return { ok: true }
        if (this.busy.has(lease.id)) throw new Error('受管理命令仍在执行，暂不能归还设备')
        release(this.state, lease, now, '主动归还，正在清理设备')
        this.tick()
        return { ok: true }
      }
      case 'cancel': {
        const waiting = this.state.queue.find((item) => item.owner === request.owner && item.id === request.requestId)
        if (waiting) cancel(this.state, waiting, now)
        const lease = this.state.leases.find((item) => item.owner === request.owner && item.requestId === request.requestId && !item.claimed)
        if (lease) release(this.state, lease, now, '取消尚未领取的设备')
        this.tick()
        return { ok: true }
      }
      case 'control': {
        const device = this.device(request.device)
        const lease = this.state.leases.find((item) => item.devices.includes(device.id))
        if (lease) release(this.state, lease, now, '管理页面强制回收整组租约')
        const waiting = this.state.queue.find((item) => item.devices.includes(device.id))
        if (waiting) cancel(this.state, waiting, now)
        transition(device, 'destroying')
        this.captures.delete(device.id)
        event(this.state, '管理页面请求销毁设备', now, device.id)
        this.save()
        if (lease) this.busy.get(lease.id)?.abort.abort()
        this.tick()
        return { ok: true }
      }
      case 'displays': return displayStates(this.ready(request))
      case 'screenshot': {
        const device = this.ready(request)
        if (request.display && !device.displays?.some((display) => display.id === request.display)) throw new Error(`设备没有这块屏幕：${request.display}`)
        let display = request.display
        // 不指定时截正在显示内容的屏幕，查不到时截主屏；没有登记屏幕的设备交给工具的默认屏幕
        if (!display && device.displays && device.displays.length > 1) display = (await displayStates(device).catch(() => [])).find((item) => item.active)?.id
        display ??= device.displays?.[0]?.id
        const captures = this.captures.get(device.id) ?? new Map()
        this.captures.set(device.id, captures)
        const key = display ?? ''
        const previous = captures.get(key)
        const generation = device.generation
        if (previous && previous.generation === generation && now - previous.time < 5000) return previous.result
        const result = screenshot(device, display).then((capture) => {
          if (device.generation !== generation) throw new Error('设备状态已改变，请重新截图')
          if (request.owner) requireLease(this.state, request.owner, request.lease!)
          return capture
        })
        const entry = { generation, time: now, result }
        captures.set(key, entry)
        result.then(() => { entry.time = Date.now() }, () => { if (captures.get(key) === entry) captures.delete(key) })
        return result
      }
      case 'run': return this.run(request)
      case 'stop':
        if (this.busy.size || this.jobs.size) throw new Error('正在执行命令或设备操作，暂不能停止服务')
        return { ok: true }
    }
  }
  // 截图和查询屏幕的设备：带租约时必须属于这份租约
  private ready(request: { device: string; owner?: string; lease?: string }) {
    const device = this.device(request.device)
    if (request.owner || request.lease) {
      const lease = requireLease(this.state, request.owner!, request.lease!)
      if (!lease.devices.includes(device.id)) throw new Error('设备不属于当前租约')
    }
    if (!['free', 'reserved', 'leased'].includes(device.status) || device.error) throw new Error('设备尚未就绪或正在回收')
    return device
  }
  async shutdown() {
    this.stopping = true
    for (const job of this.jobs.values()) job.abort.abort()
    for (const run of this.busy.values()) run.abort.abort()
    for (let attempt = 0; attempt < 500 && (this.jobs.size || this.busy.size); attempt++) await new Promise((resolve) => setTimeout(resolve, 20))
    if (this.jobs.size || this.busy.size) throw new Error('设备操作尚未停止，保留操作记录供重启恢复')
  }
  private async run(request: Extract<Request, { action: 'run' }>) {
    const lease = requireLease(this.state, request.owner, request.lease)
    if (this.busy.has(lease.id)) throw new Error('该租约已有命令在执行')
    const devices = lease.devices.map((id) => this.device(id))
    if (devices.some((device) => device.error || device.status !== 'leased')) throw new Error('设备健康检查未通过')
    const entry: Run = { abort: new AbortController(), devices: lease.devices }
    this.busy.set(lease.id, entry)
    lease.lastSeen = Date.now()
    const record = path.join(this.runDir, `${lease.id}.json`)
    try {
      this.save()
      for (const device of devices) await health(device)
      requireLease(this.state, request.owner, request.lease)
      if (entry.abort.signal.aborted) throw new Error('租约已被强制回收')
      return await new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
        const runner = path.join(import.meta.dirname, `runner${path.extname(import.meta.filename)}`)
        const child = spawn(process.execPath, [...process.execArgv, runner], {
          cwd: request.cwd, env: { ...process.env, ...deviceEnv(devices), BINOS_THREAD_ID: request.owner }, detached: true, stdio: ['pipe', 'pipe', 'pipe'],
        })
        let stdout = '', stderr = '', reason = ''
        const kill = () => { if (child.pid) { try { process.kill(-child.pid, 'SIGKILL') } catch { /* 已退出。 */ } } }
        entry.abort.signal.addEventListener('abort', kill, { once: true })
        const timer = setTimeout(() => { reason = '设备命令执行超时'; kill() }, request.timeout)
        child.stdin.on('error', () => {})
        child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); if (stdout.length > 1024 * 1024) { reason = '输出超过 1 MiB，请将完整日志写入文件'; kill() } })
        child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); if (stderr.length > 1024 * 1024) { reason = '错误输出超过 1 MiB，请将日志写入文件'; kill() } })
        child.on('error', (error) => { clearTimeout(timer); entry.abort.signal.removeEventListener('abort', kill); reject(error) })
        child.on('close', (code) => { kill(); clearTimeout(timer); entry.abort.signal.removeEventListener('abort', kill); if (entry.abort.signal.aborted) reject(new Error('租约已被强制回收')); else if (reason) reject(new Error(reason)); else resolve({ code: code ?? 1, stdout, stderr }) })
        if (child.pid) {
          const startedAt = processStartTime(child.pid)
          if (startedAt) {
            try {
              writeFileSync(record, JSON.stringify({ pid: child.pid, startedAt }), { mode: 0o600, flush: true })
              child.stdin.end(JSON.stringify(request.command))
            } catch (error) { reason = message(error); kill() }
          } else kill()
        }
      })
    } finally {
      rmSync(record, { force: true })
      this.busy.delete(lease.id)
      lease.lastSeen = Date.now()
      this.save()
      this.tick()
    }
  }
}
