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

export async function resolve(specifier, context, nextResolve) {
  if (stubUrl && specifier === "@playwright/test") {
    return { url: stubUrl, shortCircuit: true, format: "module" }
  }
  return nextResolve(specifier, context)
}
