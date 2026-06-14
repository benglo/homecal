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
  // v2 — chores board (family_members, chores, chore_completions)
  (db) => {
    db.exec(`
      CREATE TABLE family_members (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL UNIQUE,
        icon       TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      );

      CREATE TABLE chores (
        id          TEXT PRIMARY KEY,
        title       TEXT NOT NULL CHECK (length(title) > 0),
        icon        TEXT NOT NULL,
        stars       INTEGER NOT NULL DEFAULT 1 CHECK (stars >= 1 AND stars <= 5),
        frequency   TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly')),
        day_of_week INTEGER,
        assigned_to TEXT NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
        position    INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
        updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
        CHECK (
          (frequency = 'weekly' AND day_of_week BETWEEN 0 AND 6) OR
          (frequency = 'daily'  AND day_of_week IS NULL)
        )
      );

      CREATE TABLE chore_completions (
        chore_id       TEXT NOT NULL REFERENCES chores(id) ON DELETE CASCADE,
        completed_date TEXT NOT NULL CHECK (completed_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
        completed_at   TEXT NOT NULL,
        PRIMARY KEY (chore_id, completed_date)
      );

      CREATE INDEX idx_chores_assigned_to       ON chores(assigned_to);
      CREATE INDEX idx_chore_completions_date   ON chore_completions(completed_date);
    `);
  },
  // v3 — voice utterances (append-only audit log) + voice_settings singleton (spec §6)
  (db) => {
    db.exec(`
      CREATE TABLE voice_utterances (
        id            TEXT PRIMARY KEY,
        created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
        transcript    TEXT NOT NULL,
        intent_json   TEXT,
        confidence    REAL,
        status        TEXT NOT NULL CHECK (status IN (
                        'applied','confirmed','cancelled','pending','failed','silent_low_conf'
                      )),
        duration_ms   INTEGER,
        error         TEXT
      );
      CREATE INDEX idx_voice_utterances_created_at ON voice_utterances(created_at);

      CREATE TABLE voice_settings (
        id            INTEGER PRIMARY KEY CHECK (id = 1),
        mute_until    TEXT,
        updated_at    TEXT NOT NULL
      );
      INSERT OR IGNORE INTO voice_settings (id, updated_at)
      VALUES (1, strftime('%Y-%m-%dT%H:%M:%SZ','now'));
    `);
  },
  // v4 — audit source so we can measure regex-matcher hit rate from the
  // audit log without re-parsing transcripts. CHECK mirrors the existing
  // status enum so a future direct-SQL or seed-script insert can't write
  // garbage past the Zod boundary. Nullable: pre-matcher rows + non-intent
  // paths (blank STT, hallucination) legitimately have no source.
  (db) => {
    db.exec(`
      ALTER TABLE voice_utterances ADD COLUMN source TEXT
        CHECK (source IN ('matcher','llm') OR source IS NULL);
    `);
  },
  // v5 — kitchen timers. expires_at is the source of truth for the
  // countdown (wall + voice both compute remaining from now); duration_sec
  // is the running sum across explicit extensions, kept for audit.
  (db) => {
    db.exec(`
      CREATE TABLE timers (
        id              TEXT PRIMARY KEY,
        label           TEXT,
        duration_sec    INTEGER NOT NULL CHECK (duration_sec > 0),
        started_at      TEXT NOT NULL,
        expires_at      TEXT NOT NULL,
        acknowledged_at TEXT,
        created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
        updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      );
      CREATE INDEX idx_timers_expires_at ON timers(expires_at);
    `);
  },
  // v6 — kid intents audit columns. intent_name denormalised from intent_json
  // (set explicitly by the audit path, not parsed) so review queries skip
  // JSON parsing. answer is what we spoke to the kid — the primary self-
  // improvement input. concern flags rows where Haiku detected a medical /
  // abuse / self-harm disclosure (1=flagged, NULL=normal). No CHECK on
  // intent_name: Zod is the gatekeeper, and a SQLite CHECK would force a
  // table rebuild every time we add an intent. No index in v1 (~150 rows).
  (db) => {
    db.exec(`
      ALTER TABLE voice_utterances ADD COLUMN intent_name TEXT;
      ALTER TABLE voice_utterances ADD COLUMN answer TEXT;
      ALTER TABLE voice_utterances ADD COLUMN concern INTEGER;
    `);
  },
  // v7 — TTS provenance. Records WHERE the spoken reply came from so a
  // sustained kokoro_lan → openrouter drift in the audit log is visible.
  // tts_latency_ms is end-to-end wall-clock from the Pi's perspective
  // (includes LAN/cloud round-trip), distinct from the sidecar's X-Synth-Ms
  // which is server-side synth only. No CHECK on tts_provider: Zod is the
  // gatekeeper, and a SQLite CHECK forces a table rebuild every time we add
  // a provider.
  (db) => {
    db.exec(`
      ALTER TABLE voice_utterances ADD COLUMN tts_provider TEXT;
      ALTER TABLE voice_utterances ADD COLUMN tts_latency_ms INTEGER;
    `);
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
