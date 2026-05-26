// @davstack/tui — subcommand dispatcher.
//
// Currently ships `davstack start`, which renders the Ink shell. The
// other subcommands (stop/status/logs) are reserved.

import { Command } from "commander"
import React from "react"
import { render } from "ink"

import { App } from "./App.tsx"

function runStart(opts: { noColor?: boolean }): void {
  if (opts.noColor) process.env.DAVSTACK_NO_COLOR = "1"
  render(React.createElement(App))
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
