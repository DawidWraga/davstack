// Title inference for a job. Convention: spec body's first markdown
// heading (`# …`) wins. Fallback to first 5 words of the prompt with
// tag noise (`<goal>`, `<intent>`, etc.) stripped, so tag-based specs
// still get a sensible label.

const HEADING_RE = /^#+\s+(.+?)\s*#*\s*$/
const TAG_OPEN_RE = /<[a-zA-Z][\w-]*>/g
const TAG_CLOSE_RE = /<\/[a-zA-Z][\w-]*>/g

export interface TitleInput {
  prompt: string
}

export function inferAgentTitle(input: TitleInput, maxWords = 10): string {
  const body = input.prompt ?? ""
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.length === 0) continue
    const m = HEADING_RE.exec(line)
    if (m && m[1]) return m[1].trim()
    break
  }
  const stripped = body
    .replace(TAG_OPEN_RE, " ")
    .replace(TAG_CLOSE_RE, " ")
    .replace(/^\s*#+\s*/gm, " ")
  const words = stripped.replace(/\s+/g, " ").trim().split(" ").filter(Boolean)
  return words.slice(0, maxWords).join(" ")
}
