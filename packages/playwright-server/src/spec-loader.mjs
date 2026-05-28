// Node module-loader hook for playwright-server. Runs in a separate worker
// thread (Node.js loader architecture). Receives the stub-module URL via
// the `data` channel of module.register(), then redirects all
// `@playwright/test` resolutions to that stub file.
//
// Important: this hook is invoked for EVERY resolve in the process, so we
// gate on the specifier name and pass through everything else untouched.

let stubUrl = null

export async function initialize(data) {
  stubUrl = data?.stubUrl ?? null
}

// Propagate the spec's cache-bust query (`?_pwsRev=<n>` or `?t=<n>`) from a
// parent URL down to every transitively-imported file:// module. Without
// this, only the spec file itself is cache-busted on rerun and any module
// it imports (UI models, fixtures, helpers) stays pinned in Node's ESM
// cache forever. `playwright-server refresh` bumps the rev to force the
// whole spec-rooted subgraph to re-evaluate.
//
// Skips: bare specifiers (node_modules, builtins), the @playwright/test
// stub redirect, and anything not resolving to file://.
export async function resolve(specifier, context, nextResolve) {
  if (stubUrl && specifier === "@playwright/test") {
    return { url: stubUrl, shortCircuit: true, format: "module" }
  }
  const result = await nextResolve(specifier, context)
  if (!result?.url || !result.url.startsWith("file:")) return result
  if (result.url.includes("/node_modules/")) return result
  const parentURL = context?.parentURL
  if (!parentURL || !parentURL.startsWith("file:")) return result
  let parentQuery
  try {
    parentQuery = new URL(parentURL).search
  } catch {
    return result
  }
  if (!parentQuery) return result
  const parentParams = new URLSearchParams(parentQuery)
  const rev = parentParams.get("_pwsRev") ?? parentParams.get("t")
  if (!rev) return result
  let childUrl
  try {
    childUrl = new URL(result.url)
  } catch {
    return result
  }
  if (childUrl.searchParams.has("_pwsRev") || childUrl.searchParams.has("t")) return result
  childUrl.searchParams.set("_pwsRev", rev)
  return { ...result, url: childUrl.href }
}
