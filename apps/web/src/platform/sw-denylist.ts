/**
 * Navigations the PWA service worker must NOT answer with the cached app page: TutorAI Local's
 * one-time sign-in link, the ChatGPT sign-in callback, and the server's API/control routes.
 */
export const SW_DENYLIST: RegExp[] = [/^\/(api|open|auth|control)(\/|\?|$)/];
