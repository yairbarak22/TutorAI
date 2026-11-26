import { z } from "zod";

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
  features: z.object({ claudeCode: z.boolean(), chatgpt: z.boolean() }),
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
