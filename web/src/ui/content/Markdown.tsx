import 'katex/dist/katex.min.css'
import { ImageBrokenIcon } from '@phosphor-icons/react'
import { memo, useMemo } from 'react'
import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import type { Components, Options } from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { CodeBlock } from './CodeBlock.tsx'
import styles from './Markdown.module.css'
import { Mermaid } from './Mermaid.tsx'

// 行内公式 $…$，单独成段的 $$…$$
const remarkPlugins: Options['remarkPlugins'] = [remarkGfm, remarkMath]
const rehypePlugins: Options['rehypePlugins'] = [rehypeKatex]

// 围起来的代码块带语言（language-xxx）或者以换行结尾，行内代码两者都没有
function MarkdownCode({ className, children }: { className?: string; children?: ReactNode }) {
  const lang = /language-(\S+)/.exec(className ?? '')?.[1]
  const text = String(children ?? '')
  if (!lang && !text.endsWith('\n')) {
    return <code className={className}>{children}</code>
  }
  const code = text.replace(/\n$/, '')
  return lang === 'mermaid' ? <Mermaid code={code} /> : <CodeBlock code={code} lang={lang} label={lang ?? ''} />
}

export type RenderFile = (reference: string, embedded: boolean) => ReactNode

function MarkdownImage({ src, alt, renderFile }: { src: unknown; alt?: string; renderFile?: RenderFile }) {
  const file = typeof src === 'string' ? renderFile?.(src, true) : undefined
  if (file) return file
  if (typeof src !== 'string' || !/^https?:\/\//.test(src)) {
    return <span className={styles.missingImage}><ImageBrokenIcon size={14} />{alt || '图片'}</span>
  }
  return <a className={styles.image} href={src} target="_blank" rel="noreferrer"><img src={src} alt={alt ?? ''} loading="lazy" /></a>
}

// 回答过程中文本会频繁更新，内容不变的段落不重新解析
export const Markdown = memo(function Markdown({
  text,
  renderFile,
}: {
  text: string
  renderFile?: RenderFile
}) {
  const components = useMemo<Components>(
    () => ({
      a: ({ node: _node, href, children, ...props }) =>
        (href && renderFile?.(href, false)) || <a {...props} href={href} target="_blank" rel="noreferrer">{children}</a>,
      img: ({ src, alt }) => <MarkdownImage src={src} alt={alt} renderFile={renderFile} />,
      pre: ({ children }) => <div className={styles.codeBlock}>{children}</div>,
      code: ({ className, children }) => <MarkdownCode className={className}>{children}</MarkdownCode>,
      table: ({ node: _node, ...props }) => (
        <div className={styles.tableWrap}>
          <table {...props} />
        </div>
      ),
    }),
    [renderFile],
  )
  return (
    <div className={styles.markdown}>
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  )
})
