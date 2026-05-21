#!/usr/bin/env bun
// parse-claude.ts — granular Claude Code usage/cost straight from the raw
// transcript JSONL. Replaces ccusage in the pipeline; ccusage is kept only as
// a one-shot calibration oracle (see --calib).
//
//   bun parse-claude.ts                 # last 7 local days, by day
//   bun parse-claude.ts 20260516        # one local day, by day + by session
//   bun parse-claude.ts --calib 20260516 12.89   # assert total ≈ oracle $
//
// CORRECTNESS: a single API turn is written to MANY jsonl rows (thinking row,
// tool_use row, …) that REPEAT identical `usage`. Verified on real data:
// summing per-row overcounts 2.62x. We dedupe by `requestId` (== message.id).

import { readFileSync, existsSync } from "node:fs"
import { join, dirname, basename } from "node:path"
import { homedir } from "node:os"
import { fileURLToPath } from "node:url"

const PROJECTS = join(homedir(), ".claude", "projects")
const here = dirname(fileURLToPath(import.meta.url))
const PRICING = JSON.parse(readFileSync(join(here, "pricing.json"), "utf8"))

type Tier = { input: number; output: number; cacheWrite5m: number; cacheWrite1h: number; cacheRead: number }
function rate(model: string): Tier {
  if (PRICING.overrides?.[model]) return PRICING.overrides[model]
  const m = model.toLowerCase()
  for (const k of ["opus", "sonnet", "haiku"]) if (m.includes(k)) return PRICING.tiers[k]
  return PRICING.tiers.sonnet // unknown → mid tier, flagged by calibration
}

interface Turn {
  ts: string
  day: string
  session: string
  model: string
  inp: number
  out: number
  cw5m: number
  cw1h: number
  cwFlat: number
  cr: number
  cost: number
}

const localDay = (iso: string) => {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
}

function collect(): Turn[] {
  if (!existsSync(PROJECTS)) {
    console.error(`no ${PROJECTS}`)
    process.exit(1)
  }
  const seen = new Set<string>() // requestId — global dedupe (one API call once)
  const turns: Turn[] = []
  // Transcripts nest deeper than one level (subagent/sidechain sessions live
  // in subfolders) — a shallow readdir misses ~half the data, incl. all haiku.
  const glob = new Bun.Glob("**/*.jsonl")
  for (const rel of glob.scanSync({ cwd: PROJECTS, onlyFiles: true })) {
    const lines = readFileSync(join(PROJECTS, rel), "utf8").split("\n")
    for (const ln of lines) {
      if (!ln || ln[0] !== "{") continue
      let r: any
      try {
        r = JSON.parse(ln)
      } catch {
        continue
      }
      if (r.type !== "assistant") continue
      const key = r.requestId || r.message?.id
      if (!key || seen.has(key)) continue
      seen.add(key)
      const u = r.message?.usage || {}
      const model = r.message?.model || "?"
      const t = rate(model)
      const inp = u.input_tokens || 0
      const out = u.output_tokens || 0
      const cr = u.cache_read_input_tokens || 0
      const cw5m = u.cache_creation?.ephemeral_5m_input_tokens ?? 0
      const cw1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0
      // fall back to the flat rollup (priced as 5m) only if the split is absent
      const cwFlat = cw5m + cw1h ? 0 : u.cache_creation_input_tokens || 0
      const cost =
        (inp * t.input +
          out * t.output +
          cr * t.cacheRead +
          cw5m * t.cacheWrite5m +
          cw1h * t.cacheWrite1h +
          cwFlat * t.cacheWrite5m) /
        1e6
      turns.push({
        ts: r.timestamp,
        day: localDay(r.timestamp),
        session: r.sessionId || basename(rel, ".jsonl"),
        model,
        inp,
        out,
        cw5m,
        cw1h,
        cwFlat,
        cr,
        cost,
      })
    }
  }
  return turns
}

const z = (n: number) => Math.round(n).toLocaleString()
const $ = (n: number) => "$" + n.toFixed(2)

function agg<T extends string>(turns: Turn[], keyOf: (t: Turn) => T) {
  const m = new Map<T, { inp: number; out: number; cw: number; cr: number; cost: number; n: number }>()
  for (const t of turns) {
    const k = keyOf(t)
    const a = m.get(k) || { inp: 0, out: 0, cw: 0, cr: 0, cost: 0, n: 0 }
    a.inp += t.inp
    a.out += t.out
    a.cw += t.cw5m + t.cw1h + t.cwFlat
    a.cr += t.cr
    a.cost += t.cost
    a.n += 1
    m.set(k, a)
  }
  return m
}

function table(title: string, m: ReturnType<typeof agg>) {
  console.log(`\n${title}`)
  console.log(
    "key".padEnd(26) + "turns".padStart(7) + "input".padStart(12) +
      "output".padStart(11) + "cacheW".padStart(13) + "cacheR".padStart(14) + "cost".padStart(11),
  )
  let c = 0
  for (const k of [...m.keys()].sort()) {
    const a = m.get(k)!
    c += a.cost
    console.log(
      String(k).slice(0, 25).padEnd(26) + String(a.n).padStart(7) + z(a.inp).padStart(12) +
        z(a.out).padStart(11) + z(a.cw).padStart(13) + z(a.cr).padStart(14) + $(a.cost).padStart(11),
    )
  }
  console.log("-".repeat(94))
  console.log("TOTAL".padEnd(26) + " ".repeat(57) + $(c).padStart(11))
  return c
}

// --- dispatch ---
const args = process.argv.slice(2)
const all = collect()

if (args[0] === "--calib") {
  const day = args[1]
  const oracle = parseFloat(args[2])
  const total = all.filter((t) => t.day === day).reduce((s, t) => s + t.cost, 0)
  const diff = Math.abs(total - oracle)
  const pct = (diff / oracle) * 100
  console.log(`calibration ${day}: parser ${$(total)} vs oracle ${$(oracle)}  → Δ ${$(diff)} (${pct.toFixed(1)}%)`)
  console.log(pct <= 2 ? "PASS (≤2%) — pricing.json validated, ccusage retired" : "FAIL (>2%) — adjust pricing.json tiers")
  process.exit(pct <= 2 ? 0 : 1)
}

const day = args[0]
const turns = day ? all.filter((t) => t.day === day) : all.filter((t) => Number(t.day) >= Number(localDay(new Date(Date.now() - 6 * 864e5).toISOString())))
console.log(`Claude usage — ${day || "last 7 local days"}  (${turns.length} API turns, deduped by requestId)`)
table("by day:", agg(turns, (t) => t.day))
table("by model:", agg(turns, (t) => t.model))
if (day) table("by session:", agg(turns, (t) => t.session))
