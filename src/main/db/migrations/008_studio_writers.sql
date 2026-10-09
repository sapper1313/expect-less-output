-- Autonomous Studio, Phase 2: series bibles, imported skills, ideas bank, holidays.

CREATE TABLE series_bible (
  brand_id INTEGER PRIMARY KEY REFERENCES brands(id) ON DELETE CASCADE,
  bible_json TEXT NOT NULL,
  updated_utc TEXT NOT NULL
);

CREATE TABLE bible_skills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  text TEXT NOT NULL,
  created_utc TEXT NOT NULL
);
CREATE INDEX idx_bible_skills_brand ON bible_skills(brand_id);

CREATE TABLE ideas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_utc TEXT NOT NULL
);
CREATE INDEX idx_ideas_brand ON ideas(brand_id, used);

CREATE TABLE holidays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'holiday',
  enabled INTEGER NOT NULL DEFAULT 1,
  custom INTEGER NOT NULL DEFAULT 0,
  UNIQUE (date, name)
);
CREATE INDEX idx_holidays_date ON holidays(date);

-- Lowercase text of an episode's title, hook, idea and key lines, so the repetition guard never has to open packages.
ALTER TABLE episodes ADD COLUMN key_text TEXT NOT NULL DEFAULT '';
