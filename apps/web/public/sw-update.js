/*
 * Loaded by the generated service worker (vite.config.ts → workbox.importScripts).
 *
 * After an update, a tab that is already open (or the first one opened) still shows the previous
 * version's screen: it was served from the old offline copy before the new one arrived. With
 * TutorAI on the computer that means an old screen talking to a newer program, and a new feature
 * that seems to be missing. So when this worker replaces an older one, it reloads the open tabs once.
 * A first install reloads nothing.
 *
 * It has to live here and not in the page: the page that needs reloading is the old one, which
 * knows nothing about this.
 */
let replacesOlderVersion = false;

self.addEventListener("install", () => {
  replacesOlderVersion = !!self.registration.active;
});

self.addEventListener("activate", (event) => {
  if (!replacesOlderVersion) return;
  event.waitUntil(reloadOpenTabs());
});

async function reloadOpenTabs() {
  await self.clients.claim(); // a tab can only be navigated by the worker that controls it
  const tabs = await self.clients.matchAll({ type: "window" });
  await Promise.all(tabs.map((tab) => reloadTab(tab).catch(() => {})));
}

/**
 * The app's routes live in the URL hash, and navigating to the same URL with a hash does not reload.
 * So: load the page without the hash, then put the hash back (which only moves the router).
 * The one-time sign-in hash from TutorAI on the computer is never put back.
 */
async function reloadTab(tab) {
  const url = new URL(tab.url);
  const hash = url.hash;
  url.hash = "";
  const fresh = await tab.navigate(url.href.replace(/#$/, ""));
  if (fresh && hash.length > 1 && !hash.startsWith("#tutorai-token=")) await fresh.navigate(tab.url);
}
