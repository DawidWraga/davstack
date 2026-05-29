---
"@davstack/tui": patch
"@davstack/init": patch
---

Trim the generated skill CLI-reference to a lean bullet list (command +
required positionals + one-line description, with a pointer to
`<server> <command> --help` for flags) instead of an exhaustive table —
the per-flag detail was noise. Deprecated aliases are dropped from the list.

Move the daemon-lifecycle guidance ("ask the user to run `davstack start`
in a separate terminal; don't run `serve` yourself") out of every daemon
skill and into the `davstack check` failure output, since that advice only
matters at the moment a daemon is reported down.
