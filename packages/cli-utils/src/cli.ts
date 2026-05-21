// Zero-dep CLI helper for the diagnose skill's servers. Designed for the
// modest needs of `log-sink` / `playwright-server` / `vitest-server`:
// subcommand routing (1–2 deep), flag parsing with env-var fallback,
// boolean negation via --no-flag, and conventional exit codes:
//   0 = success
//   1 = handler threw / business error
//   2 = usage error (parseArgs failed)
//
// Why hand-rolled: bunli is bus-factor-1 (single maintainer, ~80 stars);
// commander/citty pull weight we don't need. Keeping this small + tested
// means no upstream surprises on `npx skills add`.

export type FlagType = 'string' | 'number' | 'boolean';
export type FlagValue = string | number | boolean;

export type FlagSpec = {
  type: FlagType;
  default?: FlagValue;
  required?: boolean;
  description?: string;
  env?: string;
};

export type Positional = {
  name: string;
  required?: boolean;
  description?: string;
};

export type CommandSpec = {
  description?: string;
  positionals?: Positional[];
  flags?: Record<string, FlagSpec>;
  commands?: Record<string, CommandSpec>;
  run?: (ctx: {
    flags: Record<string, FlagValue>;
    positionals: string[];
  }) => void | number | Promise<void | number>;
};

export type CliSpec = { name: string; description?: string } & CommandSpec;

export type ParseSuccess = {
  ok: true;
  commandPath: string[];
  flags: Record<string, FlagValue>;
  positionals: string[];
  helpRequested: boolean;
  spec: CommandSpec;
};

export type ParseFailure = {
  ok: false;
  error: string;
  commandPath: string[];
  helpRequested: boolean;
};

export type ParseResult = ParseSuccess | ParseFailure;

// ─── coercion ───────────────────────────────────────────────────────────────

export function coerceFlag(
  type: FlagType,
  raw: string,
): { ok: true; value: FlagValue } | { ok: false; error: string } {
  if (type === 'string') return { ok: true, value: raw };
  if (type === 'number') {
    if (raw.trim() === '') return { ok: false, error: 'not a number: empty' };
    const n = Number(raw);
    if (Number.isNaN(n)) return { ok: false, error: `not a number: ${JSON.stringify(raw)}` };
    return { ok: true, value: n };
  }
  // boolean
  const lower = raw.toLowerCase();
  if (lower === 'true' || lower === '1') return { ok: true, value: true };
  if (lower === 'false' || lower === '0') return { ok: true, value: false };
  return { ok: false, error: `not a boolean: ${JSON.stringify(raw)}` };
}

// ─── parseArgs ──────────────────────────────────────────────────────────────

function hasHelpFlag(argv: string[]): boolean {
  return argv.some((a) => a === '--help' || a === '-h');
}

export function parseArgs(argv: string[], spec: CliSpec): ParseResult {
  const helpRequested = hasHelpFlag(argv);
  const commandPath: string[] = [];
  let cursor: CommandSpec = spec;
  let i = 0;

  // Walk subcommand tree as long as the next token matches a known command
  // name (and we have subcommands to descend into).
  while (i < argv.length && cursor.commands) {
    const tok = argv[i];
    if (tok.startsWith('-')) break;
    const next = cursor.commands[tok];
    if (!next) {
      if (helpRequested) {
        return { ok: false, error: `unknown command: ${tok}`, commandPath, helpRequested };
      }
      return { ok: false, error: `unknown command: ${tok}`, commandPath, helpRequested: false };
    }
    commandPath.push(tok);
    cursor = next;
    i++;
  }

  // If we're sitting at a node that has subcommands but no run handler and
  // no further argv, treat as "show help for this level".
  if (cursor.commands && !cursor.run && i >= argv.length) {
    return {
      ok: true,
      commandPath,
      flags: {},
      positionals: [],
      helpRequested: true,
      spec: cursor,
    };
  }

  const flags: Record<string, FlagValue> = {};
  const positionals: string[] = [];
  const flagDefs = cursor.flags ?? {};
  const seenFlags = new Set<string>();

  while (i < argv.length) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      i++;
      continue;
    }
    if (a === '--') {
      // Everything after `--` is positional.
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith('--')) {
      let name = a.slice(2);
      let inlineValue: string | undefined;
      const eq = name.indexOf('=');
      if (eq !== -1) {
        inlineValue = name.slice(eq + 1);
        name = name.slice(0, eq);
      }

      // --no-foo negation for booleans
      let negate = false;
      if (name.startsWith('no-') && flagDefs[name.slice(3)]?.type === 'boolean') {
        negate = true;
        name = name.slice(3);
      }

      const def = flagDefs[name];
      if (!def) {
        return {
          ok: false,
          error: `unknown flag: --${negate ? 'no-' : ''}${name}`,
          commandPath,
          helpRequested,
        };
      }

      if (def.type === 'boolean') {
        if (negate) {
          flags[name] = false;
        } else if (inlineValue !== undefined) {
          const c = coerceFlag('boolean', inlineValue);
          if (!c.ok) {
            return { ok: false, error: `--${name}: ${c.error}`, commandPath, helpRequested };
          }
          flags[name] = c.value;
        } else {
          flags[name] = true;
        }
        seenFlags.add(name);
        i++;
        continue;
      }

      const raw = inlineValue !== undefined ? inlineValue : argv[++i];
      if (raw === undefined) {
        return { ok: false, error: `--${name}: missing value`, commandPath, helpRequested };
      }
      const c = coerceFlag(def.type, raw);
      if (!c.ok) {
        return { ok: false, error: `--${name}: ${c.error}`, commandPath, helpRequested };
      }
      flags[name] = c.value;
      seenFlags.add(name);
      i++;
      continue;
    }
    // Bare positional
    positionals.push(a);
    i++;
  }

  // Env-var fallback + defaults for any flag not set via argv.
  for (const [name, def] of Object.entries(flagDefs)) {
    if (seenFlags.has(name)) continue;
    if (def.env && process.env[def.env] !== undefined) {
      const c = coerceFlag(def.type, process.env[def.env] as string);
      if (!c.ok) {
        return {
          ok: false,
          error: `env ${def.env}: ${c.error}`,
          commandPath,
          helpRequested,
        };
      }
      flags[name] = c.value;
      continue;
    }
    if (def.default !== undefined) {
      flags[name] = def.default;
    }
  }

  if (!helpRequested) {
    // Required flags
    for (const [name, def] of Object.entries(flagDefs)) {
      if (def.required && flags[name] === undefined) {
        return {
          ok: false,
          error: `required flag missing: --${name}`,
          commandPath,
          helpRequested,
        };
      }
    }
    // Required positionals
    const posDefs = cursor.positionals ?? [];
    for (let p = 0; p < posDefs.length; p++) {
      const def = posDefs[p];
      if (def.required && positionals[p] === undefined) {
        return {
          ok: false,
          error: `required positional missing: ${def.name}`,
          commandPath,
          helpRequested,
        };
      }
    }
  }

  return { ok: true, commandPath, flags, positionals, helpRequested, spec: cursor };
}

// ─── defineCli ──────────────────────────────────────────────────────────────

export function defineCli(spec: CliSpec): { run(argv: string[]): Promise<number> } {
  return {
    async run(argv: string[]): Promise<number> {
      const result = parseArgs(argv, spec);
      if (!result.ok) {
        // Dynamic import to keep cold path lean.
        const { formatHelp } = await import('./cli-help.ts');
        console.error(`error: ${result.error}\n`);
        console.error(formatHelp(result.commandPath, spec));
        return 2;
      }
      if (result.helpRequested) {
        const { formatHelp } = await import('./cli-help.ts');
        console.log(formatHelp(result.commandPath, spec));
        return 0;
      }
      const handler = result.spec.run;
      if (!handler) {
        const { formatHelp } = await import('./cli-help.ts');
        console.log(formatHelp(result.commandPath, spec));
        return 0;
      }
      try {
        const code = await handler({ flags: result.flags, positionals: result.positionals });
        return typeof code === 'number' ? code : 0;
      } catch (e) {
        console.error(`error: ${(e as Error)?.message ?? e}`);
        if ((e as Error)?.stack) console.error((e as Error).stack);
        return 1;
      }
    },
  };
}
