import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { contractPath, generateContract, schemaPath } from './contract.ts'

// 后端的契约变了而这里没重新生成，web 照旧通过类型检查，到运行时才对不上
it('src/contract.ts 是从后端当前的 schema 生成的', async () => {
  const fresh = await generateContract(readFileSync(schemaPath, 'utf8'))
  expect(fresh === readFileSync(contractPath, 'utf8') ? '' : 'src/contract.ts 不是最新的，在 web/ 里运行 pnpm contract 重新生成').toBe('')
})
