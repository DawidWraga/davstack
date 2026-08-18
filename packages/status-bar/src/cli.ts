#!/usr/bin/env node
import { renderStatusLine, type StatusLineInput } from './render.js'
import { runInstall, runUninstall } from './install.js'

async function readStdin(): Promise<string> {
	const chunks: Buffer[] = []
	for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
	return Buffer.concat(chunks).toString('utf8')
}

async function render() {
	const raw = await readStdin()
	const input = JSON.parse(raw) as StatusLineInput
	process.stdout.write(renderStatusLine(input, Date.now() / 1000) + '\n')
}

const KNOWN_COMMANDS = ['install', 'uninstall', 'render']

async function main() {
	const argv = process.argv.slice(2)
	// A bare `--force`/`--dir` with no leading command word (e.g. running
	// `npx @davstack/claude-status-bar --force`) implies `install`.
	const hasExplicitCommand = argv[0] !== undefined && KNOWN_COMMANDS.includes(argv[0])
	const command = hasExplicitCommand ? argv[0] : undefined
	const rest = hasExplicitCommand ? argv.slice(1) : argv

	if (command === 'install') {
		await runInstall(rest)
		return
	}
	if (command === 'uninstall') {
		await runUninstall(rest)
		return
	}
	if (command === 'render') {
		await render()
		return
	}

	// No recognized command: running interactively (a TTY) means the user
	// launched the CLI directly to install; otherwise treat stdin as the
	// statusLine payload (this is what settings.json actually invokes).
	if (process.stdin.isTTY) {
		await runInstall(rest)
	} else {
		await render()
	}
}

main().catch((err) => {
	console.error('davstack-status-bar:', err instanceof Error ? err.message : err)
	process.exit(1)
})
