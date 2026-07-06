import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const RUNTIME_FILENAME = 'davstack-status-bar.mjs'

export interface StatusLineConfig {
	type: string
	command: string
}

export interface Settings {
	statusLine?: StatusLineConfig
	[key: string]: unknown
}

export function isOurCommand(command: string | undefined, runtimeName: string): boolean {
	if (!command) return false
	return command.includes(runtimeName)
}

export type MergeStatus = 'added' | 'updated' | 'unchanged' | 'conflict'

export function mergeSettings(
	existing: Settings,
	ourCommand: string,
	runtimeName: string,
): { settings: Settings; status: MergeStatus } {
	const settings: Settings = { ...existing }
	const current = settings.statusLine

	if (!current) {
		settings.statusLine = { type: 'command', command: ourCommand }
		return { settings, status: 'added' }
	}
	if (current.command === ourCommand) {
		return { settings, status: 'unchanged' }
	}
	if (isOurCommand(current.command, runtimeName)) {
		settings.statusLine = { type: 'command', command: ourCommand }
		return { settings, status: 'updated' }
	}
	return { settings, status: 'conflict' }
}

export function removeSettings(
	existing: Settings,
	runtimeName: string,
): { settings: Settings; removed: boolean } {
	const settings: Settings = { ...existing }
	const current = settings.statusLine
	if (current && isOurCommand(current.command, runtimeName)) {
		delete settings.statusLine
		return { settings, removed: true }
	}
	return { settings, removed: false }
}

function parseArgs(args: string[]) {
	let dir: string | undefined
	let force = false
	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--dir') {
			dir = args[++i]
		} else if (args[i] === '--force') {
			force = true
		}
	}
	return { dir: dir ?? path.join(os.homedir(), '.claude'), force }
}

function readSettings(settingsPath: string): Settings {
	if (!fs.existsSync(settingsPath)) return {}
	const raw = fs.readFileSync(settingsPath, 'utf8')
	if (!raw.trim()) return {}
	return JSON.parse(raw) as Settings
}

function writeSettings(settingsPath: string, settings: Settings) {
	fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8')
}

function backupSettings(claudeDir: string, settingsPath: string) {
	if (!fs.existsSync(settingsPath)) return
	const backupsDir = path.join(claudeDir, 'backups')
	fs.mkdirSync(backupsDir, { recursive: true })
	const stamp = new Date().toISOString().replace(/[:.]/g, '-')
	fs.copyFileSync(settingsPath, path.join(backupsDir, `settings.json.${stamp}.bak`))
}

function runtimeSourcePath(): string {
	const here = path.dirname(fileURLToPath(import.meta.url))
	// Production: this module runs compiled as dist/install.js, sibling to dist/runtime.js.
	const sibling = path.join(here, 'runtime.js')
	if (fs.existsSync(sibling)) return sibling
	// Dev/test: this module runs from src/install.ts against the built dist/ next door.
	return path.join(here, '..', 'dist', 'runtime.js')
}

export async function runInstall(args: string[]) {
	const { dir, force } = parseArgs(args)
	fs.mkdirSync(dir, { recursive: true })

	const settingsPath = path.join(dir, 'settings.json')
	const runtimePath = path.join(dir, RUNTIME_FILENAME)
	const ourCommand = `node "${runtimePath}"`

	const existing = readSettings(settingsPath)
	let { settings, status } = mergeSettings(existing, ourCommand, RUNTIME_FILENAME)

	if (status === 'conflict') {
		if (!force) {
			console.error(
				`davstack-status-bar: settings.json already has a statusLine command that isn't ours:\n` +
					`  ${existing.statusLine?.command}\n` +
					`Re-run with --force to overwrite it (a backup will be written to ${path.join(dir, 'backups')}).`,
			)
			process.exitCode = 1
			return
		}
		settings = { ...settings, statusLine: { type: 'command', command: ourCommand } }
		status = 'updated'
	}

	if (status !== 'unchanged') {
		backupSettings(dir, settingsPath)
		writeSettings(settingsPath, settings)
	}

	fs.copyFileSync(runtimeSourcePath(), runtimePath)

	console.log(`davstack-status-bar: installed to ${runtimePath}`)
	if (status === 'unchanged') console.log('settings.json already pointed at this script; runtime refreshed.')
	else console.log(`settings.json statusLine ${status}.`)
}

export async function runUninstall(args: string[]) {
	const { dir } = parseArgs(args)
	const settingsPath = path.join(dir, 'settings.json')
	const runtimePath = path.join(dir, RUNTIME_FILENAME)

	const existing = readSettings(settingsPath)
	const { settings, removed } = removeSettings(existing, RUNTIME_FILENAME)

	if (removed) {
		backupSettings(dir, settingsPath)
		writeSettings(settingsPath, settings)
	}

	if (fs.existsSync(runtimePath)) fs.rmSync(runtimePath)

	console.log(
		removed
			? `davstack-status-bar: removed statusLine from ${settingsPath} and deleted ${runtimePath}.`
			: `davstack-status-bar: no statusLine of ours found in ${settingsPath}; deleted ${runtimePath} if present.`,
	)
}
