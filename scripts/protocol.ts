import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { createGenerator } from 'ts-json-schema-generator'
import { protocolId, schemaPath } from '../server/src/protocol-id.ts'

const serverDir = path.resolve(import.meta.dirname, '../server')

// ts-json-schema-generator 用它自带的 TypeScript 5 解析：TypeScript 7 没有它要的编译器 API。类型检查由 pnpm typecheck 做
export function generateSchema() {
  const generator = createGenerator({
    path: path.join(serverDir, 'src/protocol.ts'),
    tsconfig: path.join(serverDir, 'tsconfig.json'),
    type: 'Protocol',
    expose: 'export',
    topRef: true,
    jsDoc: 'none',
    skipTypeCheck: true,
  })
  return JSON.stringify(generator.createSchema('Protocol'), null, 2) + '\n'
}

if (import.meta.main) {
  const schema = generateSchema()
  writeFileSync(schemaPath, schema)
  console.log(`已生成 ${path.relative(process.cwd(), schemaPath)}，协议标识 ${protocolId(schema)}`)
}
