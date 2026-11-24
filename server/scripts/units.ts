// 正式版分成两端各自上线：server 是后端和命令行，web 是页面
export type Unit = 'server' | 'web'
export const units: Unit[] = ['server', 'web']

// 影响页面构建结果的目录：页面（包括从后端的 schema 生成的类型）和设计源头
const webInputs = /^(web|design)\//
// 页面、iOS 和设计源头不在后端里；其余的都可能影响后端，不细分
const notServer = /^(web|ios|design)\//

// 从上一次上线这一端的提交到新提交改了 files，这一端要不要重新上线。files 为 undefined 是不知道改了什么，都重新上线
export function needsDeploy(unit: Unit, files: string[] | undefined) {
  if (!files) return true
  return files.some((file) => (unit === 'web' ? webInputs.test(file) : !notServer.test(file)))
}
