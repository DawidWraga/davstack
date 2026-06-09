# @davstack/peek

Print concise, agent-friendly folder summaries.

```sh
npx @davstack/peek .
npx @davstack/peek packages/context-compactor --agent
```

The first version uses conservative text scanning and safe default ignores for
`node_modules`, `.git`, `dist`, `.next`, coverage, and generated metadata files.
