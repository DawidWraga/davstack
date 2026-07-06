import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runInstall, runUninstall, RUNTIME_FILENAME } from '../src/install.js'

let tmpDir: string

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'status-bar-test-'))
})

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('install / uninstall round-trip', () => {
	it('writes settings.json and the runtime script into a fresh dir', async () => {
		await runInstall(['--dir', tmpDir])

		const settingsPath = path.join(tmpDir, 'settings.json')
		const runtimePath = path.join(tmpDir, RUNTIME_FILENAME)
		expect(fs.existsSync(settingsPath)).toBe(true)
		expect(fs.existsSync(runtimePath)).toBe(true)

		const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
		expect(settings.statusLine.command).toContain(RUNTIME_FILENAME)
	})

	it('preserves unrelated settings.json keys and backs the file up', async () => {
		fs.writeFileSync(
			path.join(tmpDir, 'settings.json'),
			JSON.stringify({ model: 'sonnet', permissions: { allow: ['Bash(ls:*)'] } }, null, 2),
		)

		await runInstall(['--dir', tmpDir])

		const settings = JSON.parse(fs.readFileSync(path.join(tmpDir, 'settings.json'), 'utf8'))
		expect(settings.model).toBe('sonnet')
		expect(settings.permissions.allow).toEqual(['Bash(ls:*)'])
		expect(settings.statusLine).toBeDefined()

		const backups = fs.readdirSync(path.join(tmpDir, 'backups'))
		expect(backups.length).toBe(1)
	})

	it('refuses to overwrite a foreign statusLine without --force', async () => {
		fs.writeFileSync(
			path.join(tmpDir, 'settings.json'),
			JSON.stringify({ statusLine: { type: 'command', command: 'python ~/.claude/statusline.py' } }, null, 2),
		)

		await runInstall(['--dir', tmpDir])

		const settings = JSON.parse(fs.readFileSync(path.join(tmpDir, 'settings.json'), 'utf8'))
		expect(settings.statusLine.command).toBe('python ~/.claude/statusline.py')
	})

	it('overwrites a foreign statusLine with --force', async () => {
		fs.writeFileSync(
			path.join(tmpDir, 'settings.json'),
			JSON.stringify({ statusLine: { type: 'command', command: 'python ~/.claude/statusline.py' } }, null, 2),
		)

		await runInstall(['--dir', tmpDir, '--force'])

		const settings = JSON.parse(fs.readFileSync(path.join(tmpDir, 'settings.json'), 'utf8'))
		expect(settings.statusLine.command).toContain(RUNTIME_FILENAME)
	})

	it('is idempotent: installing twice does not duplicate backups', async () => {
		await runInstall(['--dir', tmpDir])
		await runInstall(['--dir', tmpDir])

		const backupsDir = path.join(tmpDir, 'backups')
		const backups = fs.existsSync(backupsDir) ? fs.readdirSync(backupsDir) : []
		expect(backups.length).toBe(0)
	})

	it('uninstall removes our statusLine and the runtime file, leaving other keys', async () => {
		await runInstall(['--dir', tmpDir])
		fs.writeFileSync(
			path.join(tmpDir, 'settings.json'),
			JSON.stringify(
				{
					model: 'sonnet',
					statusLine: JSON.parse(fs.readFileSync(path.join(tmpDir, 'settings.json'), 'utf8')).statusLine,
				},
				null,
				2,
			),
		)

		await runUninstall(['--dir', tmpDir])

		const settings = JSON.parse(fs.readFileSync(path.join(tmpDir, 'settings.json'), 'utf8'))
		expect(settings.statusLine).toBeUndefined()
		expect(settings.model).toBe('sonnet')
		expect(fs.existsSync(path.join(tmpDir, RUNTIME_FILENAME))).toBe(false)
	})
})
