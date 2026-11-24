// 正式版分成两端各自上线：server 是后端和命令行，web 是页面
export type Unit = 'server' | 'web'
export const units: Unit[] = ['server', 'web']

// 影响页面构建结果的文件：页面、契约、设计源头，以及整个仓库的依赖和 TypeScript 配置
const webInputs = /^(web|protocol|design)\/|^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig(\.base)?\.json)$/
// iOS 的代码不在正式版里；其余的都可能影响后端，不细分
const notServer = /^(web|ios)\//

// 从上一次上线这一端的提交到新提交改了 files，这一端要不要重新上线。files 为 undefined 是不知道改了什么，都重新上线
export function needsDeploy(unit: Unit, files: string[] | undefined) {
  if (!files) return true
  return files.some((file) => (unit === 'web' ? webInputs.test(file) : !notServer.test(file)))
}
