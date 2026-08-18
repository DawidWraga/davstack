import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { renderStatusLine } from '../src/render.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const pyScript = path.join(here, 'fixtures', 'reference-statusline.py')

function pythonAvailable(): string | null {
	for (const bin of ['python3', 'python']) {
		const res = spawnSync(bin, ['--version'])
		if (res.status === 0) return bin
	}
	return null
}

function stripAnsi(s: string): string {
	return s.replace(/\x1b\[[0-9;]*m/g, '')
}

const python = pythonAvailable()

describe.skipIf(!python)('port fidelity vs statusline.py', () => {
	const cases = [
		{ context_window: { total_input_tokens: 0, total_output_tokens: 0 } },
		{ context_window: { total_input_tokens: 50_000, total_output_tokens: 25_000 } },
		{ context_window: { total_input_tokens: 200_000, total_output_tokens: 5_000 } },
		{ context_window: { total_input_tokens: 500_000, total_output_tokens: 0 } },
	]

	it.each(cases)('matches for %j (excluding rate-limit segment)', (input) => {
		const pyResult = spawnSync(python as string, [pyScript], {
			input: JSON.stringify(input),
			encoding: 'utf8',
		})
		expect(pyResult.status).toBe(0)

		const tsOut = renderStatusLine(input, Date.now() / 1000)

		// The python script isn't injectable with a fixed "now", but neither
		// case includes rate_limits, so both outputs should match exactly.
		expect(stripAnsi(tsOut).trim()).toBe(stripAnsi(pyResult.stdout).trim())
	})
})
