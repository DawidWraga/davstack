import { describe, expect, it } from 'vitest'
import { isOurCommand, mergeSettings, removeSettings } from '../src/install.js'

const RUNTIME = 'davstack-status-bar.mjs'
const OUR_COMMAND = 'node "/home/user/.claude/davstack-status-bar.mjs"'

describe('isOurCommand', () => {
	it('is false when there is no command', () => {
		expect(isOurCommand(undefined, RUNTIME)).toBe(false)
	})

	it('is true when the command references our runtime filename', () => {
		expect(isOurCommand(OUR_COMMAND, RUNTIME)).toBe(true)
	})

	it('is false for an unrelated command', () => {
		expect(isOurCommand('python ~/.claude/statusline.py', RUNTIME)).toBe(false)
	})
})

describe('mergeSettings', () => {
	it('adds statusLine when none exists, leaving other keys untouched', () => {
		const { settings, status } = mergeSettings({ model: 'sonnet' }, OUR_COMMAND, RUNTIME)
		expect(status).toBe('added')
		expect(settings.model).toBe('sonnet')
		expect(settings.statusLine).toEqual({ type: 'command', command: OUR_COMMAND })
	})

	it('is unchanged when our command is already installed', () => {
		const existing = { statusLine: { type: 'command', command: OUR_COMMAND } }
		const { settings, status } = mergeSettings(existing, OUR_COMMAND, RUNTIME)
		expect(status).toBe('unchanged')
		expect(settings.statusLine?.command).toBe(OUR_COMMAND)
	})

	it('updates when an older version of our own command is installed', () => {
		const olderCommand = 'node "/home/user/.claude/davstack-status-bar.mjs" --legacy'
		const existing = { statusLine: { type: 'command', command: olderCommand } }
		const { settings, status } = mergeSettings(existing, OUR_COMMAND, RUNTIME)
		expect(status).toBe('updated')
		expect(settings.statusLine?.command).toBe(OUR_COMMAND)
	})

	it('reports a conflict without touching a foreign statusLine', () => {
		const existing = { statusLine: { type: 'command', command: 'python ~/.claude/statusline.py' } }
		const { settings, status } = mergeSettings(existing, OUR_COMMAND, RUNTIME)
		expect(status).toBe('conflict')
		expect(settings.statusLine?.command).toBe('python ~/.claude/statusline.py')
	})
})

describe('removeSettings', () => {
	it('removes statusLine when it is ours', () => {
		const existing = { model: 'sonnet', statusLine: { type: 'command', command: OUR_COMMAND } }
		const { settings, removed } = removeSettings(existing, RUNTIME)
		expect(removed).toBe(true)
		expect(settings.statusLine).toBeUndefined()
		expect(settings.model).toBe('sonnet')
	})

	it('leaves a foreign statusLine alone', () => {
		const existing = { statusLine: { type: 'command', command: 'python ~/.claude/statusline.py' } }
		const { settings, removed } = removeSettings(existing, RUNTIME)
		expect(removed).toBe(false)
		expect(settings.statusLine?.command).toBe('python ~/.claude/statusline.py')
	})

	it('is a no-op when there is no statusLine at all', () => {
		const { settings, removed } = removeSettings({ model: 'sonnet' }, RUNTIME)
		expect(removed).toBe(false)
		expect(settings.model).toBe('sonnet')
	})
})
