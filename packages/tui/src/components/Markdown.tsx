// Tiny markdown renderer for Ink. Handles the subset our agent spec
// files actually use: headings, bullets, fenced code blocks, inline
// **bold** and `code`. Anything fancier (tables, links, blockquotes)
// falls through as plain text rather than blowing up the layout.

import React from "react"
import { Text } from "ink"

export interface MarkdownProps {
  source: string
  maxLines?: number
}

interface InlineToken {
  kind: "text" | "bold" | "code"
  value: string
}

export function Markdown({ source, maxLines }: MarkdownProps): React.ReactElement {
  const rawLines = React.useMemo(
    () => source.replace(/\r\n/g, "\n").split("\n"),
    [source],
  )
  const sliced = maxLines != null ? rawLines.slice(0, maxLines) : rawLines
  let inCodeFence = false
  const elements: React.ReactNode[] = []
  for (let i = 0; i < sliced.length; i += 1) {
    const line = sliced[i]!
    if (/^\s*```/.test(line)) {
      inCodeFence = !inCodeFence
      elements.push(
        <Text key={i} dimColor>
          {line}
        </Text>,
      )
      continue
    }
    if (inCodeFence) {
      elements.push(
        <Text key={i} color="yellow" dimColor>
          {line}
        </Text>,
      )
      continue
    }
    elements.push(renderLine(i, line))
  }
  return <>{elements}</>
}

function renderLine(key: number, line: string): React.ReactNode {
  const heading = /^(#{1,6})\s+(.*)$/.exec(line)
  if (heading) {
    const level = heading[1]!.length
    const color = level === 1 ? "cyan" : level === 2 ? "yellow" : undefined
    return (
      <Text key={key} bold color={color}>
        {heading[2]!}
      </Text>
    )
  }
  if (/^\s*---+\s*$/.test(line)) {
    return (
      <Text key={key} dimColor>
        {"─".repeat(60)}
      </Text>
    )
  }
  const bullet = /^(\s*)([-*])\s+(.*)$/.exec(line)
  if (bullet) {
    return (
      <Text key={key}>
        {bullet[1]}
        <Text color="cyan">• </Text>
        {renderInline(bullet[3]!)}
      </Text>
    )
  }
  if (line.trim().length === 0) {
    return <Text key={key}> </Text>
  }
  return <Text key={key}>{renderInline(line)}</Text>
}

function renderInline(text: string): React.ReactNode {
  const tokens = tokenizeInline(text)
  return tokens.map((t, i) => {
    if (t.kind === "bold")
      return (
        <Text key={i} bold>
          {t.value}
        </Text>
      )
    if (t.kind === "code")
      return (
        <Text key={i} color="yellow">
          {t.value}
        </Text>
      )
    return <Text key={i}>{t.value}</Text>
  })
}

function tokenizeInline(text: string): InlineToken[] {
  const out: InlineToken[] = []
  let i = 0
  while (i < text.length) {
    if (text.startsWith("**", i)) {
      const end = text.indexOf("**", i + 2)
      if (end > i + 2) {
        out.push({ kind: "bold", value: text.slice(i + 2, end) })
        i = end + 2
        continue
      }
    }
    if (text[i] === "`") {
      const end = text.indexOf("`", i + 1)
      if (end > i + 1) {
        out.push({ kind: "code", value: text.slice(i + 1, end) })
        i = end + 1
        continue
      }
    }
    let j = i + 1
    while (j < text.length && !text.startsWith("**", j) && text[j] !== "`") j += 1
    out.push({ kind: "text", value: text.slice(i, j) })
    i = j
  }
  return out
}
