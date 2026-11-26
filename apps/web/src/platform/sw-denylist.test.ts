import { describe, expect, it } from "vitest";
import { SW_DENYLIST } from "./sw-denylist.ts";

const denied = (path: string) => SW_DENYLIST.some((r) => r.test(path));

describe("service worker denylist", () => {
  it("lets the local server answer its own routes", () => {
    for (const p of ["/open?code=x", "/open", "/auth/callback?code=1&state=2", "/api/hello", "/control/code"]) expect(denied(p)).toBe(true);
  });
  it("keeps serving the app shell for app routes", () => {
    for (const p of ["/", "/index.html", "/opening", "/authors", "/apis"]) expect(denied(p)).toBe(false);
  });
});
