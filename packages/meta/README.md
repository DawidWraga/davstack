# @davstack/meta

Generate concise, agent-friendly folder metadata.

```sh
davstack-meta gen .
davstack-meta view . --deep
```

The first version uses conservative text scanning and safe default ignores for
`node_modules`, `.git`, `dist`, `.next`, coverage, and generated metadata files.
