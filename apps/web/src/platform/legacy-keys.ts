/**
 * The project was called RuecAI before, and its browser keys started with "ruecai.".
 * Imported first in main.tsx, so settings, the language, and the saved API key carry over
 * before any other module reads them. A key already set under the new name wins.
 */
const OLD = "ruecai.";
const NEW = "tutorai.";

function migrate(store: Storage) {
  const oldKeys: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i);
    if (k?.startsWith(OLD)) oldKeys.push(k);
  }
  for (const k of oldKeys) {
    const renamed = NEW + k.slice(OLD.length);
    const value = store.getItem(k);
    if (store.getItem(renamed) === null && value !== null) store.setItem(renamed, value);
    store.removeItem(k);
  }
}

for (const get of [() => localStorage, () => sessionStorage]) {
  try {
    migrate(get());
  } catch {
    /* storage blocked (private mode) — nothing to migrate */
  }
}

export {};
