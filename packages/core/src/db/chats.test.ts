import initSqlJs from "sql.js";
import { describe, expect, it } from "vitest";
import { Store } from "./store.ts";

const SQL = await initSqlJs();

describe("tutor conversation history", () => {
  it("lists conversations by last activity, titled by the first question, without empty ones", () => {
    const s = Store.open(SQL);
    const course = s.createCourse("Probability");
    const a = s.createChat(course, [
      { role: "user", content: "What is   Bayes'\ntheorem?" },
      { role: "assistant", content: "…" },
    ]);
    s.newChat(course); // empty: never listed
    const b = s.createChat(course, [{ role: "user", content: "Quiz me" }]);
    s.run("UPDATE chats SET updated_at='2026-01-01 10:00:00' WHERE id=?", [a]);
    s.run("UPDATE chats SET updated_at='2026-01-02 10:00:00' WHERE id=?", [b]);

    const list = s.chats(course);
    expect(list.map((c) => c.id)).toEqual([b, a]);
    expect(list[1]).toMatchObject({ title: "What is Bayes' theorem?", count: 2, updatedAt: "2026-01-01T10:00:00Z" });
  });

  it("opens, updates and deletes a conversation", () => {
    const s = Store.open(SQL);
    const course = s.createCourse("Law");
    const id = s.createChat(course, [{ role: "user", content: "Offer?" }]);
    s.saveChat(id, [
      { role: "user", content: "Offer?" },
      { role: "assistant", content: "Section 2." },
    ]);
    expect(s.chatById(id)?.messages).toHaveLength(2);
    expect(s.chatById(id)?.courseId).toBe(course);
    s.deleteChat(id);
    expect(s.chatById(id)).toBeUndefined();
    expect(s.chats(course)).toEqual([]);
  });
});
