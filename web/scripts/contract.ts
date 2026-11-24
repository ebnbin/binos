import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { compile } from 'json-schema-to-typescript'
import type { JSONSchema } from 'json-schema-to-typescript'

// 后端对外公开的契约：后端从它的类型生成 JSON Schema，web 和 iOS 都从这份 schema 得到自己的类型
export const schemaPath = path.resolve(import.meta.dirname, '../../server/protocol.schema.json')
export const contractPath = path.resolve(import.meta.dirname, '../src/contract.ts')

// 去掉 schema 里的 title（元组里每一项的标签）：它们会被当成单独的类型名。properties 和 definitions 下面的键是名字，不是关键字，保留
function dropTitles(value: unknown, named = false): unknown {
  if (Array.isArray(value)) return value.map((item) => dropTitles(item))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => named || key !== 'title')
      .map(([key, item]) => [key, named ? dropTitles(item) : dropTitles(item, key === 'properties' || key === 'definitions')]),
  )
}

export async function generateContract(schema: string) {
  const types = await compile(dropTitles(JSON.parse(schema)) as JSONSchema, 'Protocol', {
    bannerComment: '',
    unreachableDefinitions: true,
    additionalProperties: false,
    style: { semi: false, singleQuote: true, printWidth: 160 },
  })
  // 生成的类型上每个都带一段「由哪个定义生成」的注释，没有用
  const body = types.replace(/\/\*\*\n(?: \*.*\n)*? \*\/\n/g, '')
  return `// 由 scripts/contract.ts 从 server/protocol.schema.json 生成，不要手动修改。后端的契约变了以后在 web/ 里运行 pnpm contract\n\n${body}`
}

if (import.meta.main) {
  writeFileSync(contractPath, await generateContract(readFileSync(schemaPath, 'utf8')))
  console.log(`已从 ${path.relative(process.cwd(), schemaPath)} 生成 ${path.relative(process.cwd(), contractPath)}`)
}
