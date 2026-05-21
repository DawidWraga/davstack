// Per-run state reset for the warm Playwright host. The tab-swap pattern:
// drop the old page (which drops its DOM, JS heap, in-flight requests,
// beforeunload handlers) and open a new one in the same context. ~50ms.
// page.goto('about:blank') was observed to hang 15-25s on app pages with
// pending work; this avoids that.
//
// Auth-key preservation: the consumer's auth localStorage entries survive
// across runs (so the next spec's first goto doesn't bounce through /login).
// Everything else under the auth origin is wiped.

import type { BrowserContext, Dialog, Page } from '@playwright/test';

// Dialog auto-dismiss: a leftover confirm popover from a prior run would
// otherwise block page.close()/goto until the 30s timeout. Attach to every
// page that gets created (boot + post-reset).
export const dismissDialog = (d: Dialog) => {
  d.dismiss().catch(() => {});
};

export async function resetState(args: {
  context: BrowserContext;
  page: Page;
  authOrigin: string | null;
  authKeys: string[];
}): Promise<Page> {
  await args.context.clearCookies();
  // Strip non-auth localStorage while we still have a page on the origin —
  // page.close() drops the DOM but localStorage lives on the context.
  if (args.authOrigin && args.page.url().startsWith(args.authOrigin)) {
    await args.page
      .evaluate((keys: string[]) => {
        for (const k of Object.keys(localStorage)) {
          if (!keys.includes(k)) localStorage.removeItem(k);
        }
        sessionStorage.clear();
      }, args.authKeys)
      .catch(() => {});
  }
  const newPage = await args.context.newPage();
  newPage.on('dialog', dismissDialog);
  args.page.close({ runBeforeUnload: false }).catch(() => {});
  return newPage;
}
