#!/usr/bin/env python3
# Frozen copy of the original ~/.claude/statusline.py this package ports to
# TypeScript, used only to verify byte-for-byte parity in port-fidelity.test.ts.
import json, sys, io, time

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

CAP = 350_000

data = json.load(sys.stdin)
cw = data.get('context_window') or {}
tokens = (cw.get('total_input_tokens') or 0) + (cw.get('total_output_tokens') or 0)

pct = min(tokens / CAP, 1.0)
filled = min(int(pct * 10), 10)
bar = '█' * filled + '░' * (10 - filled)

if tokens >= 350_000:
    color = 202
elif tokens >= 300_000:
    color = 208
elif tokens >= 250_000:
    color = 220
elif tokens >= 200_000:
    color = 229
else:
    color = None

if color is not None:
    bar = f"\033[38;5;{color}m{bar}\033[0m"

k = round(tokens / 1000)
out = f"{bar} {k}k tokens"

rl = (data.get('rate_limits') or {}).get('five_hour') or {}
rl_pct = rl.get('used_percentage')
resets_at = rl.get('resets_at')
if rl_pct is not None and resets_at is not None:
    remaining = max(0, int(resets_at - time.time()))
    h = remaining // 3600
    m = (remaining % 3600) // 60
    out += f"  \033[38;5;240m| {round(rl_pct)}% · {h}:{m:02d}h\033[0m"

print(out)
