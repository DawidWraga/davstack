// @davstack/tui — subcommand dispatcher.
//
// P1 only ships `davstack start`, which renders a hardcoded Ink shell.
// Real daemon spawning lands in P2; `stop`/`status`/`logs` are reserved
// for later phases.

import { Command } from "commander"
import React from "react"
import { render } from "ink"

import { App } from "./App.tsx"

function runStart(): void {
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
  .description("Launch the TUI (P1: hardcoded shell, no real daemons yet).")
  .action(() => {
    runStart()
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
