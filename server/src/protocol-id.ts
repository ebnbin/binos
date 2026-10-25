import { createHash } from 'node:crypto'
import path from 'node:path'

// 客户端收发的 JSON 结构，pnpm protocol 从 protocol.ts 生成
export const schemaPath = path.resolve(import.meta.dirname, '../protocol.schema.json')

// schema 一变标识就变：原生客户端写着它适配的标识，和 /api/health 返回的比较
export const protocolId = (schema: string) => createHash('sha256').update(schema).digest('hex').slice(0, 12)
