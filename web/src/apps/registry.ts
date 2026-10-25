import { useMemo } from 'react'
import { builtinApplications } from './builtins.ts'
import { validateApplications } from './definitions.ts'
import { externalApp } from './external/index.ts'
import { useBuiltinApps, useExternalApps } from './external/registry.ts'
import type { ApplicationDefinition } from './types.ts'

// 内置的 app（名称由后端给出，读到之前先用 id）加上 app 注册表里的外部 app，按这个顺序排列
export function useApplications(): ApplicationDefinition[] {
  const external = useExternalApps()
  const builtin = useBuiltinApps()
  return useMemo(
    () =>
      validateApplications([
        ...builtinApplications.map((app) => ({ ...app, name: builtin?.find((item) => item.id === app.id)?.name ?? app.id })),
        ...(external ?? []).map(externalApp),
      ]),
    [builtin, external],
  )
}

// 读到 app 注册表之前，还不知道有哪些外部 app
export const useApplicationsLoaded = () => useExternalApps() !== undefined
