/** The same rule as `safeFileName` in @tutorai/core (a test in apps/web keeps the two equal). */
export function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 120);
}

/** A Moodle course name as a TutorAI course name. */
export function cleanCourseName(name: string): string {
  return name.replace(/\s+/g, " ").trim().slice(0, 120) || "Moodle";
}

/** The rule manual uploads use on the file name, applied to the file, its activity and its section. */
export function looksLikeExam(...names: string[]): boolean {
  return names.some((n) => /מבח[ןנ]|בחינ|exam|מועד/i.test(n));
}
