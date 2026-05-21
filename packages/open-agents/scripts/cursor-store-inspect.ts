#!/usr/bin/env bun
// cursor-store-inspect.ts — inspect Cursor CLI local stores (read-only).
// Bun rewrite of the former Python tool (uses bun:sqlite; no Python dep).
//
//   bun cursor-store-inspect.ts schema      # schemas of both DB types
//   bun cursor-store-inspect.ts blobs       # sniff latest chat blobs for usage fields
//   bun cursor-store-inspect.ts aipct       # AI-authored % by ISO week (scored_commits)
//   bun cursor-store-inspect.ts aipct 30    # ...limited to last N days
//
// Findings (2026-05-16): Cursor CLI keeps NO local token/cost ledger.
// - chats/*/*/store.db: blobs(id,data)=JSON messages, no usage metadata.
// - ai-tracking/ai-code-tracking.db: scored_commits has composer/human line
//   split + AI% (weak rework signal), but no tokens/cost.
// Per-invocation token usage + duration IS available, but only live on the
// cursor-agent CLI's `--output-format json` result line (see usage-today.ts).

import { Database } from "bun:sqlite"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { existsSync, statSync, copyFileSync, mkdtempSync } from "node:fs"

const HOME = homedir()
const TRACK_DB = join(HOME, ".cursor", "ai-tracking", "ai-code-tracking.db")

// Open read-only. If the live DB is locked (WAL writer active), fall back to a
// throwaway copy — same defensive posture as the old Python immutable=1.
function open(path: string): Database {
  try {
    const db = new Database(path, { readonly: true })
    db.query("select 1").get()
    return db
  } catch {
    const tmp = join(mkdtempSync(join(tmpdir(), "csi-")), "snap.db")
    copyFileSync(path, tmp)
    for (const sfx of ["-wal", "-shm"]) {
      if (existsSync(path + sfx)) copyFileSync(path + sfx, tmp + sfx)
    }
    return new Database(tmp, { readonly: true })
  }
}

function latestChatDb(): string | null {
  const root = join(HOME, ".cursor", "chats")
  if (!existsSync(root)) return null
  const glob = new Bun.Glob("*/*/store.db")
  let best: string | null = null
  let bestM = -1
  for (const rel of glob.scanSync({ cwd: root, onlyFiles: true })) {
    const full = join(root, rel)
    const m = statSync(full).mtimeMs
    if (m > bestM) {
      bestM = m
      best = full
    }
  }
  return best
}

function cmdSchema() {
  for (const [label, path] of [
    ["AI-CODE-TRACKING", TRACK_DB],
    ["LATEST CHAT", latestChatDb()],
  ] as const) {
    if (!path || !existsSync(path)) {
      console.log(label, "-> (missing)")
      continue
    }
    console.log("=".repeat(68))
    console.log(label, "->", path, `(${statSync(path).size} bytes)`)
    const db = open(path)
    const tables = db
      .query<{ name: string }, []>(
        "select name from sqlite_master where type='table' order by name",
      )
      .all()
    for (const { name } of tables) {
      const n = (db.query(`select count(*) c from "${name}"`).get() as { c: number }).c
      const cols = db
        .query<{ name: string }, []>(`PRAGMA table_info("${name}")`)
        .all()
        .map((r) => r.name)
        .join(", ")
      console.log(`  TABLE ${name} rows=${n}\n    ${cols}`)
    }
    db.close()
  }
}

function cmdBlobs() {
  const path = latestChatDb()
  if (!path) {
    console.log("no chat db")
    return
  }
  console.log("scanning", path)
  const db = open(path)
  const pats = ["inputTokens", "outputTokens", "cost", "cacheRead", "promptTokens"]
  const hits: Record<string, number> = {}
  const rows = db.query<{ data: Uint8Array }, []>("select data from blobs").all()
  for (const { data } of rows) {
    const buf = Buffer.from(data)
    for (const p of pats) if (buf.includes(p)) hits[p] = (hits[p] || 0) + 1
  }
  db.close()
  console.log(
    "usage-field hits across blobs:",
    Object.keys(hits).length ? hits : "NONE (no usage metadata persisted)",
  )
}

function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const day = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - day)
  const yStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  const wk = Math.ceil(((t.getTime() - yStart.getTime()) / 86400000 + 1) / 7)
  return `${t.getUTCFullYear()}-W${String(wk).padStart(2, "0")}`
}

function cmdAipct(days?: number) {
  if (!existsSync(TRACK_DB)) {
    console.log("no tracking db")
    return
  }
  const db = open(TRACK_DB)
  const cutoff = days ? Date.now() - days * 86400000 : null
  const rows = db
    .query<
      {
        commitDate: string
        composerLinesAdded: number
        humanLinesAdded: number
        tabLinesAdded: number
        v2AiPercentage: string | number | null
      },
      []
    >(
      "select commitDate, composerLinesAdded, humanLinesAdded, " +
        "tabLinesAdded, v2AiPercentage from scored_commits",
    )
    .all()
  db.close()

  const by = new Map<string, { comp: number; hum: number; tab: number; pct: number[] }>()
  for (const r of rows) {
    const dt = new Date(String(r.commitDate).replace("Z", "+00:00"))
    if (isNaN(dt.getTime())) continue
    if (cutoff && dt.getTime() < cutoff) continue
    const wk = isoWeek(dt)
    const b = by.get(wk) || { comp: 0, hum: 0, tab: 0, pct: [] }
    b.comp += r.composerLinesAdded || 0
    b.hum += r.humanLinesAdded || 0
    b.tab += r.tabLinesAdded || 0
    const p = typeof r.v2AiPercentage === "string" ? parseFloat(r.v2AiPercentage) : r.v2AiPercentage
    if (p != null && !isNaN(p)) b.pct.push(p)
    by.set(wk, b)
  }

  console.log(
    "week".padEnd(9) + "composer".padStart(11) + "human".padStart(11) +
      "tab".padStart(9) + "avgAI%".padStart(8),
  )
  for (const wk of [...by.keys()].sort()) {
    const b = by.get(wk)!
    const avg = b.pct.length ? b.pct.reduce((s, x) => s + x, 0) / b.pct.length : 0
    console.log(
      wk.padEnd(9) + String(b.comp).padStart(11) + String(b.hum).padStart(11) +
        String(b.tab).padStart(9) + (avg.toFixed(1) + "%").padStart(8),
    )
  }
}

const cmd = process.argv[2] || "schema"
if (cmd === "schema") cmdSchema()
else if (cmd === "blobs") cmdBlobs()
else if (cmd === "aipct") cmdAipct(process.argv[3] ? parseInt(process.argv[3], 10) : undefined)
else console.log("usage: bun cursor-store-inspect.ts schema|blobs|aipct [days]")
