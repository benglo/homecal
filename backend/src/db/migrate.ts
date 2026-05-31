import type Database from 'better-sqlite3';

/**
 * Lightweight user_version migration runner.
 * Rules: append-only, forward-only. Never edit a shipped migration.
 * Each runs inside a transaction; user_version is bumped atomically with it.
 */
type Migration = (db: Database.Database) => void;

const MIGRATIONS: Migration[] = [
  // v1 — initial schema (spec §6.2)
  (db) => {
    db.exec(`
      CREATE TABLE categories (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL UNIQUE,
        color      TEXT NOT NULL,
        icon       TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
        CHECK (color GLOB '#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]')
      );

      CREATE TABLE events (
        id          TEXT PRIMARY KEY,
        category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
        title       TEXT NOT NULL CHECK (length(title) > 0),
        start       TEXT NOT NULL,
        end_at      TEXT NOT NULL,
        all_day     INTEGER NOT NULL DEFAULT 0 CHECK (all_day IN (0,1)),
        location    TEXT,
        rrule       TEXT,
        created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
        updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
        CHECK (end_at >= start)
      );

      CREATE TABLE event_exceptions (
        event_id        TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        occurrence_date TEXT NOT NULL,
        kind            TEXT NOT NULL CHECK (kind IN ('cancelled','modified')),
        title    TEXT,
        start    TEXT,
        end_at   TEXT,
        location TEXT,
        PRIMARY KEY (event_id, occurrence_date)
      );

      CREATE TABLE dinners (
        date       TEXT PRIMARY KEY CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
        meal       TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      );

      CREATE INDEX idx_events_window   ON events(start, end_at);
      CREATE INDEX idx_events_rrule    ON events(rrule) WHERE rrule IS NOT NULL;
      CREATE INDEX idx_events_category ON events(category_id);
    `);
    seedCategories(db);
  },
];

/** Seed categories — idempotent, Okabe–Ito palette from the design system. */
function seedCategories(db: Database.Database): void {
  const seeds: Array<{ id: string; name: string; color: string; icon: string }> = [
    { id: 'cat-appointments', name: 'Appointments', color: '#0072B2', icon: 'clipboard-check' },
    { id: 'cat-activities', name: 'Activities', color: '#CC79A7', icon: 'sparkles' },
    { id: 'cat-school', name: 'School', color: '#E69F00', icon: 'backpack' },
    { id: 'cat-sport', name: 'Sport', color: '#009E73', icon: 'activity' },
    { id: 'cat-dinner', name: 'Dinner', color: '#D55E00', icon: 'utensils' },
    { id: 'cat-uncategorized', name: 'Uncategorized', color: '#56B4E9', icon: 'circle' },
  ];
  const insert = db.prepare(
    `INSERT INTO categories (id, name, color, icon) VALUES (@id, @name, @color, @icon)
     ON CONFLICT(name) DO NOTHING`
  );
  for (const s of seeds) insert.run(s);
}

export function runMigrations(db: Database.Database): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  for (let v = current; v < MIGRATIONS.length; v++) {
    const migrate = MIGRATIONS[v];
    const tx = db.transaction(() => {
      migrate(db);
      db.pragma(`user_version = ${v + 1}`);
    });
    tx();
  }
}
