const ESC = '\x1b'
const CAP = 350_000

export interface ContextWindow {
	total_input_tokens?: number
	total_output_tokens?: number
}

export interface RateLimitWindow {
	used_percentage?: number
	resets_at?: number
}

export interface StatusLineInput {
	context_window?: ContextWindow
	rate_limits?: { five_hour?: RateLimitWindow }
}

function colorForTokens(tokens: number): number | null {
	if (tokens >= 350_000) return 202
	if (tokens >= 300_000) return 208
	if (tokens >= 250_000) return 220
	if (tokens >= 200_000) return 229
	return null
}

export function renderStatusLine(input: StatusLineInput, nowSeconds: number): string {
	const cw = input.context_window ?? {}
	const tokens = (cw.total_input_tokens ?? 0) + (cw.total_output_tokens ?? 0)

	const pct = Math.min(tokens / CAP, 1.0)
	const filled = Math.min(Math.floor(pct * 10), 10)
	let bar = '█'.repeat(filled) + '░'.repeat(10 - filled)

	const color = colorForTokens(tokens)
	if (color !== null) {
		bar = `${ESC}[38;5;${color}m${bar}${ESC}[0m`
	}

	const k = Math.round(tokens / 1000)
	let out = `${bar} ${k}k tokens`

	const rl = input.rate_limits?.five_hour ?? {}
	const rlPct = rl.used_percentage
	const resetsAt = rl.resets_at
	if (rlPct !== undefined && rlPct !== null && resetsAt !== undefined && resetsAt !== null) {
		const remaining = Math.max(0, Math.floor(resetsAt - nowSeconds))
		const h = Math.floor(remaining / 3600)
		const m = Math.floor((remaining % 3600) / 60)
		out += `  ${ESC}[38;5;240m| ${Math.round(rlPct)}% · ${h}:${String(m).padStart(2, '0')}h${ESC}[0m`
	}

	return out
}
