import { describe, expect, it } from 'vitest'
import { renderStatusLine } from '../src/render.js'

const NOW = 1_700_000_000

describe('renderStatusLine', () => {
	it('renders an empty bar with no tokens', () => {
		const out = renderStatusLine({}, NOW)
		expect(out).toBe('░░░░░░░░░░ 0k tokens')
	})

	it('renders a partially filled bar with no color below 200k', () => {
		const out = renderStatusLine(
			{ context_window: { total_input_tokens: 50_000, total_output_tokens: 25_000 } },
			NOW,
		)
		expect(out).toBe('██░░░░░░░░ 75k tokens')
	})

	it('colors the bar yellow-ish at 200k', () => {
		const out = renderStatusLine({ context_window: { total_input_tokens: 200_000 } }, NOW)
		expect(out).toBe('\x1b[38;5;229m█████░░░░░\x1b[0m 200k tokens')
	})

	it('colors the bar orange at 250k, 300k, and 350k+', () => {
		expect(renderStatusLine({ context_window: { total_input_tokens: 250_000 } }, NOW)).toContain(
			'\x1b[38;5;220m',
		)
		expect(renderStatusLine({ context_window: { total_input_tokens: 300_000 } }, NOW)).toContain(
			'\x1b[38;5;208m',
		)
		expect(renderStatusLine({ context_window: { total_input_tokens: 350_000 } }, NOW)).toContain(
			'\x1b[38;5;202m',
		)
	})

	it('caps the bar fill at 10 blocks past the cap', () => {
		const out = renderStatusLine({ context_window: { total_input_tokens: 500_000 } }, NOW)
		expect(out).toContain('██████████')
		expect(out).toContain('500k tokens')
	})

	it('omits the rate-limit segment when absent', () => {
		const out = renderStatusLine({ context_window: { total_input_tokens: 1000 } }, NOW)
		expect(out).not.toContain('%')
	})

	it('appends the rate-limit segment when present', () => {
		const out = renderStatusLine(
			{
				context_window: { total_input_tokens: 1000 },
				rate_limits: { five_hour: { used_percentage: 42.4, resets_at: NOW + 3661 } },
			},
			NOW,
		)
		expect(out).toContain('\x1b[38;5;240m| 42% · 1:01h\x1b[0m')
	})

	it('clamps remaining time at zero when resets_at is in the past', () => {
		const out = renderStatusLine(
			{
				context_window: { total_input_tokens: 1000 },
				rate_limits: { five_hour: { used_percentage: 10, resets_at: NOW - 100 } },
			},
			NOW,
		)
		expect(out).toContain('| 10% · 0:00h')
	})
})
