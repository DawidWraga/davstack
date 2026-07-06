# @davstack/claude-status-bar

A battery-like token-usage status bar for [Claude Code](https://claude.com/claude-code): a
10-segment bar that fills and shifts from yellow to orange as you approach the context
window cap, plus the current 5-hour rate-limit usage and time-to-reset.

## Install

```sh
npx @davstack/claude-status-bar
```

This writes a self-contained runtime script to `~/.claude/davstack-status-bar.mjs` and adds
a `statusLine` entry to `~/.claude/settings.json`. It won't touch any other key in that file,
and it backs up your existing `settings.json` to `~/.claude/backups/` before changing it.

If you already have a different `statusLine` configured, the installer refuses to overwrite it:

```sh
npx @davstack/claude-status-bar --force   # overwrite an existing statusLine
```

## Uninstall

```sh
npx @davstack/claude-status-bar uninstall
```

Removes the `statusLine` entry (only if it's still ours) and deletes the installed script.

## Manual install

If you'd rather not run an npx script against your config, do it by hand:

1. Copy [`dist/runtime.js`](./dist/runtime.js) from this package to `~/.claude/davstack-status-bar.mjs`.
2. Add this to `~/.claude/settings.json`:
   ```json
   "statusLine": {
     "type": "command",
     "command": "node \"~/.claude/davstack-status-bar.mjs\""
   }
   ```

## Requirements

Node.js >= 20 on the machine running Claude Code (used only for the status line command
itself — no dependency on Python).
