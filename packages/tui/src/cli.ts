// @davstack/tui — subcommand dispatcher.
//
// Ships `davstack start` (Ink shell) and `davstack check` (one-shot
// daemon probe + start hint). Other subcommands (stop/status/logs) are
// reserved.

import { Command } from "commander"
import React from "react"
import { render } from "ink"

import { App } from "./App.tsx"
import { runCheck, formatResult, exitCodeFor } from "./commands/check.ts"

function runStart(opts: { noColor?: boolean }): void {
  if (opts.noColor) process.env.DAVSTACK_NO_COLOR = "1"
  // Use the terminal's alternate screen buffer so view transitions
  // (drill in/back) don't leak prior frames into scrollback when Ink
  // shrinks its render region. Falls back to a one-shot scrollback
  // wipe when stdout isn't a TTY or DAVSTACK_NO_ALTSCREEN is set.
  const altScreen =
    process.stdout.isTTY === true && process.env.DAVSTACK_NO_ALTSCREEN !== "1"
  if (altScreen) {
    process.stdout.write("\x1b[?1049h\x1b[H")
  } else {
    process.stdout.write("\x1b[2J\x1b[3J\x1b[H")
  }
  const restore = () => {
    if (altScreen) process.stdout.write("\x1b[?1049l")
  }
  process.once("exit", restore)
  process.once("SIGINT", () => {
    restore()
    process.exit(130)
  })
  process.once("SIGTERM", () => {
    restore()
    process.exit(143)
  })
  const ink = render(React.createElement(App))
  ink.waitUntilExit().finally(restore)
}

const program = new Command()

program
  .name("davstack")
  .description("Long-running TUI that owns the davstack daemons.")
  .showHelpAfterError()
  .exitOverride()

program
  .command("start")
  .description("Launch the TUI.")
  .option("--no-color", "Disable ANSI colors (also respects NO_COLOR env)")
  .action((opts: { color?: boolean }) => {
    // commander maps `--no-color` to opts.color === false.
    runStart({ noColor: opts.color === false })
  })

program
  .command("check")
  .description("Probe configured daemons; reports running status + start hint if missing.")
  .option("--no-color", "Disable ANSI colors (also respects NO_COLOR env)")
  .action(async (opts: { color?: boolean }) => {
    const result = await runCheck()
    const useColor =
      opts.color !== false && !process.env.NO_COLOR && !process.env.DAVSTACK_NO_COLOR
    process.stdout.write(formatResult(result, useColor) + "\n")
    process.exit(exitCodeFor(result))
  })

try {
  program.parse(process.argv)
} catch (err) {
  const exitErr = err as { code?: string; exitCode?: number }
  if (exitErr.code === "commander.helpDisplayed" || exitErr.code === "commander.help") {
    process.exit(0)
  }
  // commander already prints help-after-error for unknown commands/options
  // (via showHelpAfterError above), so we just propagate the exit code.
  process.exit(exitErr.exitCode ?? 1)
}
