import { useEffect, useState } from 'react'
import type { HighlighterCore, ThemedToken } from 'shiki/core'
import { xcodeDark, xcodeLight } from './xcode-themes.ts'

// 超过这么长的代码不高亮，直接显示
const maxLength = 100_000

// 高亮器和各语言的语法都在第一次用到时才加载
let highlighter: Promise<HighlighterCore> | undefined

function getHighlighter() {
  highlighter ??= Promise.all([import('shiki/core'), import('shiki/engine/javascript')]).then(([{ createHighlighterCore }, { createJavaScriptRegexEngine }]) =>
    createHighlighterCore({
      themes: [xcodeLight, xcodeDark],
      langs: [],
      engine: createJavaScriptRegexEngine(),
    }),
  )
  return highlighter
}

// 浅色、深色两套颜色都在 token 的 htmlStyle 里（--shiki-light、--shiki-dark），由 CSS 按系统外观选用。不认识的语言返回 undefined
async function highlight(code: string, lang: string): Promise<ThemedToken[][] | undefined> {
  const { bundledLanguages } = await import('shiki/langs')
  const loader = bundledLanguages[lang as keyof typeof bundledLanguages]
  if (!loader) {
    return undefined
  }
  const instance = await getHighlighter()
  if (!instance.getLoadedLanguages().includes(lang)) {
    await instance.loadLanguage(loader)
  }
  return instance.codeToTokens(code, { lang, themes: { light: 'xcode-light', dark: 'xcode-dark' }, defaultColor: false }).tokens
}

// 高亮好之前（以及代码变了、新的还没高亮好时）返回 undefined，先显示原样的代码
export function useHighlight(code: string, lang: string | undefined): ThemedToken[][] | undefined {
  const [result, setResult] = useState<{ code: string; lang: string; tokens: ThemedToken[][] }>()
  useEffect(() => {
    if (!lang || code.length > maxLength) {
      return
    }
    let cancelled = false
    highlight(code, lang)
      .then((tokens) => {
        if (!cancelled && tokens) {
          setResult({ code, lang, tokens })
        }
      })
      .catch(() => {
        // 高亮失败就显示原样的代码
      })
    return () => {
      cancelled = true
    }
  }, [code, lang])
  return result?.code === code && result.lang === lang ? result.tokens : undefined
}

const extensionLanguages: Record<string, string> = {
  mjs: 'js',
  cjs: 'js',
  mts: 'ts',
  cts: 'ts',
  htm: 'html',
  yml: 'yaml',
  h: 'c',
  hpp: 'cpp',
  zsh: 'sh',
  jsonl: 'json',
}

// 按文件名猜语言，交给 Shiki 认；认不出就不高亮
export function languageOf(file: string): string | undefined {
  const name = file.split('/').at(-1) ?? ''
  if (/^dockerfile$/i.test(name)) {
    return 'docker'
  }
  if (/^makefile$/i.test(name)) {
    return 'make'
  }
  const extension = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase()
  return extension && (extensionLanguages[extension] ?? extension)
}
