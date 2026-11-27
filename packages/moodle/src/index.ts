/**
 * Moodle connection: pure TypeScript shared by TutorAI Local (which makes the calls) and the web
 * app (types, planning, the institution list). No Node APIs and no DOM. See docs/rfc-moodle.md.
 */
export * from "./schemas.ts";
export * from "./institutions.ts";
export * from "./public-config.ts";
export * from "./link.ts";
export * from "./client.ts";
export * from "./flatten.ts";
export * from "./plan.ts";
export * from "./names.ts";
