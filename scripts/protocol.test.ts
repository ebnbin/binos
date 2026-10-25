import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, it } from 'vitest'
import { protocolId, schemaPath } from '../server/src/protocol-id.ts'
import { generateSchema } from './protocol.ts'

const repoDir = path.resolve(import.meta.dirname, '..')
const schemaFile = path.relative(repoDir, schemaPath)
const schema = readFileSync(schemaPath, 'utf8')

// 原生客户端各自写着它适配的协议标识
const clients = [
  { name: 'iOS', file: 'ios/binOS/Core/Protocol.swift', pattern: /\bprotocolID\s*=\s*"([0-9a-f]{12})"/, example: 'static let protocolID = "<标识>"' },
  { name: 'Android', file: 'android/app/src/main/java/app/binos/net/Protocol.kt', pattern: /\bPROTOCOL_ID\s*=\s*"([0-9a-f]{12})"/, example: 'const val PROTOCOL_ID = "<标识>"' },
]

it('schema 和 protocol.ts 一致', () => {
  const fresh = generateSchema()
  expect(fresh === schema ? '' : `${schemaFile} 不是最新的，运行 pnpm protocol 重新生成。有变化的部分：${changes(schema, fresh).join('、')}`).toBe('')
}, 60_000)

for (const client of clients) {
  const file = path.join(repoDir, client.file)
  it.skipIf(!existsSync(file))(`${client.name} 客户端适配的是当前的协议`, () => {
    const adapted = client.pattern.exec(readFileSync(file, 'utf8'))?.[1]
    expect(adapted, `${client.file} 里没有协议标识，格式是 ${client.example}`).toBeDefined()
    const current = protocolId(schema)
    expect(
      adapted === current ? '' : `${client.name} 客户端适配的协议是 ${adapted}，当前是 ${current}：按 ${schemaFile} 更新 ${client.name} 的模型，再把 ${client.file} 里的标识改成 ${current}。${since(adapted!)}`,
    ).toBe('')
  })
}

// 原生客户端适配的那一版 schema 之后变了哪些定义和路由
function since(id: string) {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repoDir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  try {
    for (const commit of git('log', '--format=%H', '--', schemaFile).split('\n').filter(Boolean)) {
      const old = git('show', `${commit}:${schemaFile}`)
      if (protocolId(old) === id) {
        return `它是提交 ${commit.slice(0, 7)} 的 schema，之后有变化的部分：${changes(old, schema).join('、')}。完整的差异用 git diff ${commit.slice(0, 7)} -- ${schemaFile}`
      }
    }
  } catch {
    // 没有 git 历史时只给出标识
  }
  return `git 历史里找不到标识是 ${id} 的 schema`
}

// 按定义列出，Http、Sse 这些路由表再细到每个路由
function changes(before: string, after: string) {
  const parts = (text: string) => {
    const definitions = (JSON.parse(text) as { definitions: Record<string, { properties?: Record<string, unknown> }> }).definitions
    return new Map(
      Object.entries(definitions).flatMap(([name, definition]) =>
        ['Http', 'Errors', 'Sse', 'WebSockets'].includes(name) ? Object.entries(definition.properties ?? {}).map(([route, value]) => [`${name} ${route}`, JSON.stringify(value)]) : [[name, JSON.stringify(definition)]],
      ),
    )
  }
  const [a, b] = [parts(before), parts(after)]
  return [...new Set([...a.keys(), ...b.keys()])].flatMap((key) => (!a.has(key) ? [`新增 ${key}`] : !b.has(key) ? [`删除 ${key}`] : a.get(key) !== b.get(key) ? [`修改 ${key}`] : []))
}
