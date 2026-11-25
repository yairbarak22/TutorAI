export const SCHEMA_VERSION = 1;

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS courses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  exam_date TEXT,
  minutes_per_day INTEGER NOT NULL DEFAULT 90,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'material',          -- material | sample_exam
  mime TEXT NOT NULL DEFAULT '',
  path TEXT NOT NULL,                               -- relative to the data folder
  hash TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',           -- pending | parsing | analyzing | ready | error
  progress REAL NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  ord INTEGER NOT NULL,
  anchor TEXT NOT NULL,                             -- "p. 4" | "Slide 7" | "Section 3" (or the Hebrew equivalents)
  page INTEGER,                                     -- 1-based page/slide number when known
  title TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sections_course ON sections(course_id, source_id, ord);

CREATE TABLE IF NOT EXISTS concepts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  name_en TEXT NOT NULL DEFAULT '',
  definition TEXT NOT NULL DEFAULT '',
  prerequisites TEXT NOT NULL DEFAULT '[]',         -- JSON array of names
  section_ids TEXT NOT NULL DEFAULT '[]',           -- JSON array of "S12"
  UNIQUE(course_id, name)
);

CREATE TABLE IF NOT EXISTS artifacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  tool_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  data TEXT NOT NULL,
  params TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  concept TEXT NOT NULL,
  item_ref TEXT NOT NULL,
  correct INTEGER NOT NULL,
  score REAL NOT NULL,
  answer TEXT NOT NULL DEFAULT '',
  feedback TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mastery (
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  concept TEXT NOT NULL,
  p_known REAL NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (course_id, concept)
);

CREATE TABLE IF NOT EXISTS cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  artifact_id INTEGER REFERENCES artifacts(id) ON DELETE CASCADE,
  front TEXT NOT NULL,
  back TEXT NOT NULL,
  concept TEXT NOT NULL DEFAULT '',
  citations TEXT NOT NULL DEFAULT '[]',
  fsrs TEXT NOT NULL,
  due TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS cards_due ON cards(course_id, due);

CREATE TABLE IF NOT EXISTS chats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  messages TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tag TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;
