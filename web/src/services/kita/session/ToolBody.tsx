import { diffLines } from 'diff'
import { sessionFileUrl } from '../api.ts'
import { CodeBlock } from '../../../ui/content/CodeBlock.tsx'
import { languageOf } from '../../../ui/content/highlight.ts'
import { Markdown } from './Markdown.tsx'
import styles from './ToolBody.module.css'
import type { ToolCall, ToolResult } from './tools.ts'
import { useFullCall } from './useFullCall.ts'

// 展开一次工具调用看到的内容：常用的几类按各自的样子显示，其他的显示参数和输出
export function ToolBody({ thread, seq, ...shown }: { thread: string; seq: number; call: ToolCall; result: ToolResult | undefined }) {
  const { call, result } = useFullCall(thread, seq, shown.call, shown.result)
  // 出错的调用显示报错；命令的报错就是它的输出，照样显示成终端
  const failed = result?.status === 'error' && call.tool.kind !== 'command'
  return (
    <>
      {failed ? <Output result={result} /> : <Content thread={thread} call={call} result={result} />}
      {result?.images?.map((file) => (
        <a key={file} className={styles.image} href={sessionFileUrl(thread, file)} target="_blank" rel="noreferrer">
          <img src={sessionFileUrl(thread, file)} alt="" />
        </a>
      ))}
    </>
  )
}

function Content({ thread, call, result }: { thread: string; call: ToolCall; result: ToolResult | undefined }) {
  const { tool } = call
  switch (tool.kind) {
    case 'command':
      return <Terminal command={tool.command} result={result} />
    case 'read':
      return result?.output ? <FileContent path={tool.path} output={result.output} /> : null
    case 'edit':
      switch (tool.change?.type) {
        case 'write':
          return <CodeBlock code={tool.change.content.replace(/\n$/, '')} lang={languageOf(tool.path)} startLine={1} />
        case 'replace':
          return <Diff before={tool.change.before} after={tool.change.after} replaceAll={Boolean(tool.change.all)} />
        case 'diff':
          return <Patch op={tool.change.op} diff={tool.change.diff} path={tool.path} />
        default:
          return <Raw call={call} result={result} />
      }
    case 'web_search':
      return result?.output ? <SearchResults thread={thread} output={result.output} /> : null
    case 'web_fetch':
      return (
        <>
          {tool.prompt && <p className={styles.note}>{tool.prompt}</p>}
          {result?.output && <Markdown thread={thread} text={result.output} />}
        </>
      )
    default:
      return <Raw call={call} result={result} />
  }
}

// 原始的参数和输出
function Raw({ call, result }: { call: ToolCall; result: ToolResult | undefined }) {
  return (
    <>
      <CodeBlock code={JSON.stringify(call.input ?? call.tool, null, 2)} lang="json" />
      <Output result={result} />
    </>
  )
}

function Output({ result }: { result: ToolResult | undefined }) {
  if (!result?.output) {
    return null
  }
  return (
    <pre className={styles.output} data-error={result.status === 'error'}>
      {result.truncated || result.clipped ? `…（前面的输出已省略）\n${result.output}` : result.output}
    </pre>
  )
}

function Terminal({ command, result }: { command: string; result: ToolResult | undefined }) {
  return (
    <pre className={styles.terminal}>
      <span className={styles.prompt}>$ </span>
      {command}
      {result?.output && (
        <span className={styles.terminalOutput} data-error={result.status === 'error'}>
          {'\n'}
          {(result.truncated || result.clipped) && '…（前面的输出已省略）\n'}
          {result.output}
        </span>
      )}
    </pre>
  )
}

// 读文件的输出每行是「行号\t内容」（最后的空行只有行号）：拆出行号，内容按文件类型高亮。对不上这个格式（比如被截断了）就原样显示
function FileContent({ path, output }: { path: string; output: string }) {
  const lines = output.split('\n').map((line) => /^\s*(\d+)(?:\t(.*))?$/.exec(line))
  if (lines.some((match) => !match)) {
    return <pre className={styles.output}>{output}</pre>
  }
  return <CodeBlock code={lines.map((match) => match![2] ?? '').join('\n')} lang={languageOf(path)} startLine={Number(lines[0]![1])} />
}

function Diff({ before, after, replaceAll }: { before: string; after: string; replaceAll: boolean }) {
  const parts = diffLines(before, after)
  return (
    <div className={styles.diff}>
      {replaceAll && <div className={styles.note}>替换全部出现的地方</div>}
      <pre className={styles.diffLines}>
        {parts.flatMap((part, i) =>
          part.value
            .replace(/\n$/, '')
            .split('\n')
            .map((line, j) => (
              <span key={`${i}-${j}`} className={styles.diffLine} data-change={part.added ? 'added' : part.removed ? 'removed' : undefined}>
                <span className={styles.diffSign}>{part.added ? '+' : part.removed ? '-' : ' '}</span>
                {line}
                {'\n'}
              </span>
            )),
        )}
      </pre>
    </div>
  )
}

// 按 diff 改的一个文件：新建时 diff 是文件内容，删除时是删掉的内容，修改时是统一格式的 diff
function Patch({ op, diff, path }: { op: 'add' | 'update' | 'delete'; diff: string; path: string }) {
  if (op === 'add') {
    return <CodeBlock code={diff.replace(/\n$/, '')} lang={languageOf(path)} startLine={1} />
  }
  if (op === 'delete') {
    return <p className={styles.note}>删除了这个文件</p>
  }
  return (
    <div className={styles.diff}>
      <pre className={styles.diffLines}>
        {diff
          .replace(/\n$/, '')
          .split('\n')
          .filter((line) => !line.startsWith('+++') && !line.startsWith('---'))
          .map((line, i) => {
            const sign = line[0]
            const change = sign === '+' ? 'added' : sign === '-' ? 'removed' : undefined
            return (
              <span key={i} className={styles.diffLine} data-change={change} data-hunk={sign === '@' || undefined}>
                <span className={styles.diffSign}>{change ? sign : ' '}</span>
                {sign === '+' || sign === '-' || sign === ' ' ? line.slice(1) : line}
                {'\n'}
              </span>
            )
          })}
      </pre>
    </div>
  )
}

// 搜索网页的输出：一行「Links: [JSON]」列出搜到的网页，后面是总结
function SearchResults({ thread, output }: { thread: string; output: string }) {
  const match = /^Links: (\[.*\])$/m.exec(output)
  let links: { title?: string; url?: string }[] = []
  try {
    links = match ? JSON.parse(match[1]) : []
  } catch {
    // 解析不了就只显示文字
  }
  const summary = match ? output.slice(match.index + match[0].length).trim() : output
  return (
    <>
      {links.length > 0 && (
        <ul className={styles.links}>
          {links.map((link, i) =>
            link.url ? (
              <li key={i}>
                <a href={link.url} target="_blank" rel="noreferrer">
                  <span className={styles.linkTitle}>{link.title || link.url}</span>
                  <span className={styles.linkHost}>{hostOf(link.url)}</span>
                </a>
              </li>
            ) : null,
          )}
        </ul>
      )}
      {summary && <Markdown thread={thread} text={summary} />}
    </>
  )
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}
