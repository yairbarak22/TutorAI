/**
 * Minimal, dependency-free template renderer for declarative plugins.
 *
 *   {{name}}              → value (missing → throws, so typos are caught by CI)
 *   {{params.focus}}      → nested lookup
 *   {{#if params.focus}}…{{/if}}  → included only when value is non-empty
 */
export function renderTemplate(template: string, vars: Record<string, unknown>): string {
  const lookup = (path: string): unknown =>
    path.split(".").reduce<unknown>((acc, key) => (acc == null ? undefined : (acc as Record<string, unknown>)[key]), vars);

  const withIfs = template.replace(/\{\{#if\s+([\w.]+)\s*\}\}([\s\S]*?)\{\{\/if\}\}/g, (_m, path: string, body: string) => {
    const v = lookup(path);
    return v === undefined || v === null || v === "" ? "" : body;
  });

  return withIfs.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, path: string) => {
    const v = lookup(path);
    if (v === undefined) throw new Error(`Template variable "${path}" is not defined`);
    return String(v ?? "");
  });
}
