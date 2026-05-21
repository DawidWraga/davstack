#!/usr/bin/env bun
// usage-today.ts — reconstruct Composer (cursor-jobs) usage for a given day
// from the raw stream-json logs. Read-only; works WITHOUT the (deferred)
// cursor-jobs ledger patch by re-parsing each job's .ndjson `result` event.
//
//   bun experiments/_scripts/usage-today.ts            # today (local date)
//   bun experiments/_scripts/usage-today.ts 20260515   # a specific YYYYMMDD
//
// Claude side is parse-claude.ts (own parser); ccusage is only a calibration
// oracle, not part of the pipeline.

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"

interface Usage {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}
interface JobMeta {
  id: string
  repoPath?: string
  model?: string
  status?: string
  edit?: boolean
  rawLogPath?: string
}
interface Row {
  id: string
  repo: string
  model: string
  status: string
  edit: boolean
  durMs: number | null
  usage: Usage | null
  isError?: boolean
}

const JOBS = join(homedir(), ".cursor-jobs", "jobs")

// genId() stamps job ids as YYYYMMDD-HHMMSS-xxxx in LOCAL time, so the id
// prefix is a reliable local-day key (matches how we scope Claude's day too).
const day =
  process.argv[2] ||
  (() => {
    const d = new Date()
    const p = (n: number) => String(n).padStart(2, "0")
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
  })()

if (!existsSync(JOBS)) {
  console.error(`no cursor-jobs store at ${JOBS}`)
  process.exit(1)
}

const rows: Row[] = []
for (const repoHash of readdirSync(JOBS)) {
  const dir = join(JOBS, repoHash)
  if (!statSync(dir).isDirectory()) continue
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json") || !f.startsWith(day)) continue
    let meta: JobMeta
    try {
      meta = JSON.parse(readFileSync(join(dir, f), "utf8"))
    } catch {
      continue
    }
    const row: Row = {
      id: meta.id,
      repo: (meta.repoPath || "").split(/[\\/]/).pop() || repoHash,
      model: meta.model || "?",
      status: meta.status || "?",
      edit: !!meta.edit,
      durMs: null,
      usage: null,
    }
    const log = meta.rawLogPath
    if (log && existsSync(log)) {
      const lines = readFileSync(log, "utf8").split("\n")
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        const ln = lines[i]
        if (!ln.startsWith('{"type":"result"')) continue
        try {
          const ev = JSON.parse(ln)
          row.durMs = ev.duration_ms ?? null
          row.usage = ev.usage || null
          row.isError = !!ev.is_error
        } catch {}
        break
      }
    }
    rows.push(row)
  }
}

rows.sort((a, b) => a.id.localeCompare(b.id))

const z = (n?: number) => (n || 0).toLocaleString()
const secs = (ms: number | null) => (ms == null ? "   ?" : `${Math.round(ms / 1000)}s`)

console.log(`\nComposer / cursor-jobs usage — ${day}  (${rows.length} job(s))\n`)
const H = ["job id", "repo", "model", "st", "dur", "in", "out", "cacheR", "cacheW"]
console.log(
  H[0].padEnd(22) + H[1].padEnd(20) + H[2].padEnd(16) + H[3].padEnd(7) +
    H[4].padStart(6) + H[5].padStart(11) + H[6].padStart(9) +
    H[7].padStart(12) + H[8].padStart(10),
)
const tot = { in: 0, out: 0, cr: 0, cw: 0, ms: 0, ok: 0 }
const byModel: Record<string, { in: number; out: number; n: number }> = {}
for (const r of rows) {
  const u = r.usage || {}
  tot.in += u.inputTokens || 0
  tot.out += u.outputTokens || 0
  tot.cr += u.cacheReadTokens || 0
  tot.cw += u.cacheWriteTokens || 0
  tot.ms += r.durMs || 0
  if (r.usage && !r.isError) tot.ok += 1
  const m = (byModel[r.model] ||= { in: 0, out: 0, n: 0 })
  m.in += u.inputTokens || 0
  m.out += u.outputTokens || 0
  m.n += 1
  const st = r.status === "done" ? "ok" : r.status.slice(0, 4)
  console.log(
    r.id.padEnd(22) + r.repo.slice(0, 19).padEnd(20) + r.model.slice(0, 15).padEnd(16) +
      st.padEnd(7) + secs(r.durMs).padStart(6) + z(u.inputTokens).padStart(11) +
      z(u.outputTokens).padStart(9) + z(u.cacheReadTokens).padStart(12) +
      z(u.cacheWriteTokens).padStart(10),
  )
}
console.log("-".repeat(101))
console.log(
  `TOTAL (${tot.ok}/${rows.length} w/ usage)`.padEnd(43) + secs(tot.ms).padStart(6) +
    z(tot.in).padStart(11) + z(tot.out).padStart(9) +
    z(tot.cr).padStart(12) + z(tot.cw).padStart(10),
)
console.log("\nby model:")
for (const [m, v] of Object.entries(byModel)) {
  console.log(`  ${m.padEnd(18)} ${v.n} job(s)  in=${z(v.in)}  out=${z(v.out)}`)
}
console.log(
  "\nnote: Composer $ is NOT in the cursor-agent output (Cursor meters it\n" +
    "server-side). Tokens + wall-clock are exact; cost needs Cursor’s published\n" +
    "Composer rate applied to these token counts.",
)
