import { sectionKey, type Store } from "./db/store.ts";

/** A small course description used for evals, tests and the in-app demo course. */
export interface CourseFixture {
  course: string;
  exam_date: string | null;
  sources: {
    name: string;
    kind: "material" | "sample_exam";
    sections: { anchor: string; page?: number; title: string; summary?: string; text: string }[];
  }[];
  concepts: {
    name: string;
    name_en: string;
    definition: string;
    prerequisites: string[];
    /** [sourceIndex, sectionIndex] pairs */
    sections: [number, number][];
  }[];
}

/** Inserts a fixture as an already-processed course. Returns the course id. */
export function seedCourse(store: Store, fx: CourseFixture): number {
  const courseId = store.createCourse(fx.course, fx.exam_date);
  const idMap: number[][] = [];
  fx.sources.forEach((src, i) => {
    const text = src.sections.map((s) => s.text).join("\n\n");
    const sourceId = store.addSource({
      course_id: courseId,
      name: src.name,
      kind: src.kind,
      mime: "text/plain",
      path: `fixtures/${i}.txt`,
      hash: `fixture-${fx.course}-${i}-${text.length}`,
      size: text.length,
    });
    const ids = store.replaceSections(
      courseId,
      sourceId,
      src.sections.map((s, j) => ({ anchor: s.anchor, page: s.page ?? j + 1, title: s.title, text: s.text })),
    );
    src.sections.forEach((s, j) => s.summary && store.updateSectionMeta(ids[j], s.title, s.summary));
    store.setSourceStatus(sourceId, "ready", 1);
    idMap.push(ids);
  });
  for (const c of fx.concepts)
    store.upsertConcept(courseId, {
      name: c.name,
      name_en: c.name_en,
      definition: c.definition,
      prerequisites: c.prerequisites,
      section_ids: c.sections.map(([si, j]) => sectionKey(idMap[si][j])),
    });
  return courseId;
}
