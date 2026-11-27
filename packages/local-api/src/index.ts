import { z } from "zod";
import { MoodleErrorKind, RemoteCourse, RemoteFile } from "@tutorai/moodle";

/**
 * The HTTP contract between TutorAI Local (apps/local) and the web app (apps/web).
 * Both sides import these schemas, so a change here is a change to both.
 * See docs/impl-local-server.md §3.
 */

export const DEFAULT_PORT = 4317;
export const PORT_RANGE = 10; // 4317..4326
export const CSRF_HEADER = "x-tutorai";
export const SESSION_COOKIE = "tutorai_session";

export const LocalProvider = z.enum(["claude-code", "chatgpt"]);
export type LocalProvider = z.infer<typeof LocalProvider>;

export const AnyProvider = z.enum(["claude", "local", "hybrid", "claude-code", "chatgpt"]);
export type AnyProvider = z.infer<typeof AnyProvider>;

export const Tier = z.enum(["fast", "smart"]);

const Image = z.object({ mediaType: z.enum(["image/png", "image/jpeg"]), base64: z.string() });

export const LLMRequest = z.object({
  provider: LocalProvider,
  tier: Tier,
  system: z.string().optional(),
  context: z.string().optional(),
  prompt: z.string(),
  images: z.array(Image).max(20).optional(),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })).optional(),
  jsonSchema: z.record(z.string(), z.unknown()).optional(),
  maxTokens: z.number().int().positive().optional(),
  tag: z.string().optional(),
});
export type LLMRequest = z.infer<typeof LLMRequest>;

export const ErrorKind = z.enum(["auth", "rate_limit", "refusal", "invalid_output", "network", "not_installed", "not_eligible", "other"]);
export type ErrorKind = z.infer<typeof ErrorKind>;

export const Usage = z.object({ input: z.number(), output: z.number(), cacheRead: z.number() });

export const LLMEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("delta"), text: z.string() }),
  z.object({ type: z.literal("result"), text: z.string(), json: z.unknown().optional(), model: z.string(), usage: Usage }),
  z.object({ type: z.literal("error"), kind: ErrorKind, message: z.string(), resetAt: z.string().optional() }),
]);
export type LLMEvent = z.infer<typeof LLMEvent>;

export const Hello = z.object({
  app: z.literal("tutorai-local"),
  version: z.string(),
  platform: z.string(),
  arch: z.string(),
  dataDir: z.string(),
  features: z.object({ claudeCode: z.boolean(), chatgpt: z.boolean(), moodle: z.boolean().default(false) }),
  /** Tests only: the server accepts a mock Moodle on 127.0.0.1 (docs/impl-moodle.md §3.4). */
  testMode: z.boolean().default(false),
});
export type Hello = z.infer<typeof Hello>;

export const Connections = z.object({
  claudeCode: z.object({
    installed: z.boolean(),
    path: z.string().optional(),
    version: z.string().optional(),
    versionOk: z.boolean(),
    loggedIn: z.boolean(),
    authMethod: z.string().optional(),
    needsGitBash: z.boolean().optional(),
    hint: z.string().optional(),
  }),
  chatgpt: z.object({
    signedIn: z.boolean(),
    email: z.string().optional(),
    models: z.array(z.object({ slug: z.string(), name: z.string() })).optional(),
  }),
});
export type Connections = z.infer<typeof Connections>;

const ModelPair = z.object({ fast: z.string(), smart: z.string() });

export const Settings = z.object({
  provider: AnyProvider.optional(),
  models: z.object({ "claude-code": ModelPair, chatgpt: ModelPair }),
  dataDir: z.string(),
  autoUpdate: z.boolean(),
  claudeCodeEnabled: z.boolean(),
  localModelBase: z.string().optional(),
  chatgptWelcomeShown: z.boolean(),
  /** The smart tier in hybrid mode when it is a plan provider. */
  hybridSmart: z.enum(["claude", "claude-code", "chatgpt"]).optional(),
  /** Overrides the built-in default for the Moodle connection. Stored only when someone sets it. */
  moodleEnabled: z.boolean().optional(),
});
export type Settings = z.infer<typeof Settings>;
export const SettingsPatch = Settings.partial();
export type SettingsPatch = z.infer<typeof SettingsPatch>;

export const DEFAULT_CLAUDE_CODE_MODELS = { fast: "claude-haiku-5-5", smart: "claude-sonnet-5-5" } as const;

export const Folder = z.object({ path: z.string(), label: z.string() });
export type Folder = z.infer<typeof Folder>;
export const Browse = z.object({ path: z.string(), parent: z.string().nullable(), dirs: z.array(z.string()) });
export type Browse = z.infer<typeof Browse>;

export const InstallEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("log"), line: z.string() }),
  z.object({ type: z.literal("done"), ok: z.boolean(), error: z.string().optional() }),
]);
export type InstallEvent = z.infer<typeof InstallEvent>;

export const UpdateStatus = z.object({ current: z.string(), latest: z.string().nullable(), staged: z.boolean(), auto: z.boolean() });
export type UpdateStatus = z.infer<typeof UpdateStatus>;

export const LoginStarted = z.object({ started: z.boolean(), manualCommand: z.string() });
export const ChatgptStart = z.object({ authorizeUrl: z.string() });
export const Logout = z.object({ revoked: z.boolean() });

export const LocalProxyRequest = z.object({
  path: z.string().regex(/^\/(api|v1)\//),
  method: z.enum(["GET", "POST"]),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.string().optional(),
});
export type LocalProxyRequest = z.infer<typeof LocalProxyRequest>;

/** Usage events from a plan carry this model prefix, so the Usage view shows "included in your plan". */
export const PLAN_MODEL_PREFIX = "plan:";

/* ---------------- Moodle connection (docs/rfc-moodle.md §8) ---------------- */

export { MoodleErrorKind, RemoteCourse, RemoteFile };

export const MoodleInstitutions = z.object({
  institutions: z.array(
    z.object({
      id: z.string(),
      name: z.object({ he: z.string(), en: z.string() }),
      status: z.enum(["verified", "config-checked", "mobile-off", "unreachable"]),
    }),
  ),
});
export type MoodleInstitutions = z.infer<typeof MoodleInstitutions>;

export const MoodleCandidate = z.object({
  /** Server-issued key (the validated wwwroot). */
  site: z.string(),
  host: z.string(),
  siteName: z.string().max(80),
  institutionId: z.string(),
  login: z.enum(["sso", "unavailable"]),
  reason: z.enum(["disabled", "mobile_off", "maintenance", "password_only"]).optional(),
});
export type MoodleCandidate = z.infer<typeof MoodleCandidate>;

export const MoodleResolveRequest = z.object({ institutionId: z.string().max(40) });
export const MoodleResolve = z.object({
  candidates: z.array(MoodleCandidate),
  /** Why there are no candidates. */
  problem: z.enum(["offline", "timeout", "not_moodle", "refused"]).optional(),
});
export type MoodleResolve = z.infer<typeof MoodleResolve>;

export const MoodleConnection = z.object({
  site: z.string(),
  host: z.string(),
  siteName: z.string(),
  institutionId: z.string().optional(),
  fullName: z.string(),
  connectedAt: z.string(),
  expired: z.boolean(),
});
export type MoodleConnection = z.infer<typeof MoodleConnection>;

export const MoodlePending = z.object({
  id: z.string(),
  site: z.string(),
  /** "auto": TutorAI opens by itself after sign-in. "manual": the student pastes the link. */
  mode: z.enum(["auto", "manual"]),
  state: z.enum(["waiting", "verifying", "failed"]),
  error: MoodleErrorKind.optional(),
  expiresAt: z.string(),
});
export type MoodlePending = z.infer<typeof MoodlePending>;

export const MoodleStatus = z.object({ connections: z.array(MoodleConnection), pending: MoodlePending.nullable() });
export type MoodleStatus = z.infer<typeof MoodleStatus>;

export const MoodleStartRequest = z.object({ site: z.string().max(300) });
export const MoodleStart = z.object({
  pendingId: z.string(),
  /** Both sides also check it with isSafeLaunchUrl before using it. */
  launchUrl: z.string().max(700),
  mode: z.enum(["auto", "manual"]),
  expiresAt: z.string(),
});
export type MoodleStart = z.infer<typeof MoodleStart>;

export const MoodlePasteRequest = z.object({ pendingId: z.string().max(64), text: z.string().max(4096) });
export const MoodlePasteResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }),
  z.object({
    ok: z.literal(false),
    kind: z.enum(["not_a_link", "wrong_site", "expired"]),
    hint: z.enum(["page_address", "signin_address", "other_moodle_page", "not_a_link"]).optional(),
  }),
]);
export type MoodlePasteResult = z.infer<typeof MoodlePasteResult>;

export const MoodleCancelRequest = z.object({ pendingId: z.string().max(64) });
export const MoodleDisconnectRequest = z.object({ site: z.string().max(300) });
/** The control route the sign-in handler calls. */
export const MoodleLinkRequest = z.object({ link: z.string().max(1100) });

export const MoodleLang = z.enum(["he", "en"]);
export const MoodleCourses = z.object({ courses: z.array(RemoteCourse) });
export const MoodleContents = z.object({
  files: z.array(RemoteFile),
  other: z.object({ textPages: z.number(), links: z.number(), external: z.number(), notImportable: z.record(z.string(), z.number()) }),
});
export type MoodleContents = z.infer<typeof MoodleContents>;

export const MoodleDownloadRequest = z.object({
  site: z.string().max(300),
  remoteCourseId: z.number().int().positive(),
  key: z.string().max(600),
  /** The TutorAI course the file goes into. */
  courseId: z.number().int().positive(),
  /** Hashes of the sources already in that course, so a duplicate is never written. */
  knownHashes: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(5000),
});
export type MoodleDownloadRequest = z.infer<typeof MoodleDownloadRequest>;

export const MoodleDownloadEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("progress"), received: z.number(), total: z.number().nullable() }),
  z.object({ type: z.literal("done"), path: z.string(), hash: z.string(), size: z.number(), name: z.string() }),
  z.object({ type: z.literal("duplicate"), hash: z.string() }),
  z.object({ type: z.literal("error"), kind: MoodleErrorKind }),
]);
export type MoodleDownloadEvent = z.infer<typeof MoodleDownloadEvent>;

/** Request bodies on Moodle routes are small; the server refuses anything larger. */
export const MOODLE_BODY_LIMIT = 256 * 1024;
