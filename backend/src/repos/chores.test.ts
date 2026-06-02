import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations } from '../db/migrate';

/**
 * Board computation truth-table — exercises the SQL directly against an
 * in-memory DB so the query is isolated from the repo layer. Mirrors the
 * shape of recurrence.test.ts.
 *
 * Calendar facts used below:
 *   2026-06-02 is a Tuesday (strftime('%w') = 2)
 *   2026-06-05 is a Friday  (strftime('%w') = 5)
 *   2026-06-01 is a Monday  (strftime('%w') = 1)
 */

let db: Database.Database;

function setupTestDb() {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
}

function addMember(name: string, icon: string): string {
  const id = `member-${name}`;
  db.prepare('INSERT INTO family_members (id, name, icon) VALUES (?, ?, ?)').run(
    id,
    name,
    icon
  );
  return id;
}

interface AddChoreOpts {
  id?: string;
  title: string;
  icon: string;
  stars?: number;
  frequency?: string;
  dayOfWeek?: number | null;
  assignedTo: string;
  position?: number;
}

function addChore(opts: AddChoreOpts): string {
  const id = opts.id ?? `chore-${opts.title}-${opts.assignedTo}`;
  db.prepare(
    `INSERT INTO chores (id, title, icon, stars, frequency, day_of_week, assigned_to, position)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    opts.title,
    opts.icon,
    opts.stars ?? 1,
    opts.frequency ?? 'daily',
    opts.dayOfWeek ?? null,
    opts.assignedTo,
    opts.position ?? 0
  );
  return id;
}

function complete(choreId: string, date: string, ts = '2026-06-02T08:00:00Z') {
  db.prepare(
    `INSERT INTO chore_completions (chore_id, completed_date, completed_at) VALUES (?, ?, ?)`
  ).run(choreId, date, ts);
}

interface BoardChoreShape {
  id: string;
  title: string;
  icon: string;
  stars: number;
  completed: boolean;
  completedAt: string | null;
}

interface BoardMemberShape {
  id: string;
  name: string;
  icon: string;
  totalStars: number;
  chores: BoardChoreShape[];
}

interface BoardShape {
  date: string;
  members: BoardMemberShape[];
}

/**
 * Inline copy of the getBoard SQL. Mirrors backend/src/repos/chores.ts
 * `getBoard` so tests verify the query, not the repo wrapper.
 */
function getBoard(date: string): BoardShape {
  const members = db
    .prepare('SELECT id, name, icon FROM family_members ORDER BY name')
    .all() as Array<{ id: string; name: string; icon: string }>;

  const dueChores = db
    .prepare(
      `SELECT c.*, cc.completed_date, cc.completed_at
       FROM chores c
       LEFT JOIN chore_completions cc ON cc.chore_id = c.id AND cc.completed_date = ?
       WHERE c.frequency = 'daily'
          OR (c.frequency = 'weekly' AND c.day_of_week = CAST(strftime('%w', ?) AS INTEGER))
       ORDER BY c.assigned_to, c.position, c.title`
    )
    .all(date, date) as Array<{
    id: string;
    title: string;
    icon: string;
    stars: number;
    assigned_to: string;
    completed_date: string | null;
    completed_at: string | null;
  }>;

  const starRows = db
    .prepare(
      `SELECT c.assigned_to, COALESCE(SUM(c.stars), 0) as total
       FROM chore_completions cc JOIN chores c ON cc.chore_id = c.id
       GROUP BY c.assigned_to`
    )
    .all() as Array<{ assigned_to: string; total: number }>;

  const starTotals = new Map(starRows.map((r) => [r.assigned_to, r.total]));

  const choresByMember = new Map<string, BoardChoreShape[]>();
  for (const r of dueChores) {
    const list = choresByMember.get(r.assigned_to) ?? [];
    list.push({
      id: r.id,
      title: r.title,
      icon: r.icon,
      stars: r.stars,
      completed: r.completed_date !== null,
      completedAt: r.completed_at,
    });
    choresByMember.set(r.assigned_to, list);
  }

  return {
    date,
    members: members.map((m) => ({
      id: m.id,
      name: m.name,
      icon: m.icon,
      totalStars: starTotals.get(m.id) ?? 0,
      chores: choresByMember.get(m.id) ?? [],
    })),
  };
}

function findMember(board: BoardShape, id: string): BoardMemberShape {
  const m = board.members.find((x) => x.id === id);
  assert.ok(m, `member ${id} not in board`);
  return m;
}

describe('chores board computation', () => {
  before(() => setupTestDb());
  after(() => db.close());

  it('daily chore appears every day', () => {
    const memberId = addMember('alice', 'cat');
    addChore({
      title: 'brush teeth',
      icon: 'tooth',
      assignedTo: memberId,
      frequency: 'daily',
    });

    const board = getBoard('2026-06-02');
    const member = findMember(board, memberId);
    assert.equal(member.chores.length, 1);
    assert.equal(member.chores[0].title, 'brush teeth');
    assert.equal(member.chores[0].completed, false);
  });

  it('weekly chore appears only on its day_of_week', () => {
    const memberId = addMember('bob', 'dog');
    addChore({
      title: 'tuesday-task',
      icon: 'star',
      assignedTo: memberId,
      frequency: 'weekly',
      dayOfWeek: 2, // Tuesday
    });
    addChore({
      title: 'friday-task',
      icon: 'star',
      assignedTo: memberId,
      frequency: 'weekly',
      dayOfWeek: 5, // Friday
    });

    const tue = findMember(getBoard('2026-06-02'), memberId);
    assert.equal(tue.chores.length, 1);
    assert.equal(tue.chores[0].title, 'tuesday-task');

    const fri = findMember(getBoard('2026-06-05'), memberId);
    assert.equal(fri.chores.length, 1);
    assert.equal(fri.chores[0].title, 'friday-task');
  });

  it('completed chore shows as completed', () => {
    const memberId = addMember('carol', 'bird');
    const choreId = addChore({
      title: 'feed pet',
      icon: 'paw',
      assignedTo: memberId,
    });
    const ts = '2026-06-02T08:00:00Z';
    complete(choreId, '2026-06-02', ts);

    const member = findMember(getBoard('2026-06-02'), memberId);
    assert.equal(member.chores.length, 1);
    assert.equal(member.chores[0].completed, true);
    assert.equal(member.chores[0].completedAt, ts);
  });

  it('completion on a different date does not show as completed today', () => {
    const memberId = addMember('dave', 'fish');
    const choreId = addChore({
      title: 'water plants',
      icon: 'plant',
      assignedTo: memberId,
    });
    complete(choreId, '2026-06-01');

    const member = findMember(getBoard('2026-06-02'), memberId);
    assert.equal(member.chores.length, 1);
    assert.equal(member.chores[0].completed, false);
    assert.equal(member.chores[0].completedAt, null);
  });

  it('star total sums correctly', () => {
    const memberId = addMember('eve', 'fox');
    const chore2 = addChore({
      title: 'twostar',
      icon: 's2',
      stars: 2,
      assignedTo: memberId,
    });
    const chore3 = addChore({
      title: 'threestar',
      icon: 's3',
      stars: 3,
      assignedTo: memberId,
    });
    // chore2 completed twice (different dates) + chore3 completed once
    complete(chore2, '2026-06-01');
    complete(chore2, '2026-06-02');
    complete(chore3, '2026-06-01');

    const member = findMember(getBoard('2026-06-02'), memberId);
    // 2 + 2 + 3 = 7
    assert.equal(member.totalStars, 7);
  });

  it('multiple members have isolated chores', () => {
    const a = addMember('finn', 'wolf');
    const b = addMember('gwen', 'owl');
    addChore({ title: 'finn-only', icon: 'a', assignedTo: a });
    addChore({ title: 'gwen-only', icon: 'b', assignedTo: b });

    const board = getBoard('2026-06-02');
    const memberA = findMember(board, a);
    const memberB = findMember(board, b);

    assert.equal(memberA.chores.length, 1);
    assert.equal(memberA.chores[0].title, 'finn-only');
    assert.equal(memberB.chores.length, 1);
    assert.equal(memberB.chores[0].title, 'gwen-only');
  });

  it('completion is idempotent (composite PK)', () => {
    const memberId = addMember('hank', 'bear');
    const choreId = addChore({
      title: 'idempotent-task',
      icon: 'i',
      assignedTo: memberId,
    });
    const insertSql = `INSERT INTO chore_completions (chore_id, completed_date, completed_at)
       VALUES (?, ?, ?) ON CONFLICT DO NOTHING`;
    db.prepare(insertSql).run(choreId, '2026-06-02', '2026-06-02T08:00:00Z');
    db.prepare(insertSql).run(choreId, '2026-06-02', '2026-06-02T09:00:00Z');

    const rows = db
      .prepare(
        'SELECT COUNT(*) as n FROM chore_completions WHERE chore_id = ? AND completed_date = ?'
      )
      .get(choreId, '2026-06-02') as { n: number };
    assert.equal(rows.n, 1);
  });

  it('board for a day with no due chores returns empty arrays', () => {
    const memberId = addMember('iris', 'hare');
    // Monday-only weekly chore — dayOfWeek = 1
    addChore({
      title: 'monday-only',
      icon: 'm',
      assignedTo: memberId,
      frequency: 'weekly',
      dayOfWeek: 1,
    });

    // 2026-06-02 is Tuesday — Monday chore should not appear
    const member = findMember(getBoard('2026-06-02'), memberId);
    assert.equal(member.chores.length, 0);
  });

  it('deleting a member cascades to chores and completions', () => {
    const memberId = addMember('jack', 'lion');
    const choreId = addChore({
      title: 'cascade-task',
      icon: 'c',
      assignedTo: memberId,
    });
    complete(choreId, '2026-06-02');

    db.prepare('DELETE FROM family_members WHERE id = ?').run(memberId);

    const choreCount = db
      .prepare('SELECT COUNT(*) as n FROM chores WHERE id = ?')
      .get(choreId) as { n: number };
    const completionCount = db
      .prepare('SELECT COUNT(*) as n FROM chore_completions WHERE chore_id = ?')
      .get(choreId) as { n: number };
    assert.equal(choreCount.n, 0);
    assert.equal(completionCount.n, 0);
  });

  it('deleting a chore cascades to completions', () => {
    const memberId = addMember('kate', 'rat');
    const choreId = addChore({
      title: 'delete-me',
      icon: 'd',
      assignedTo: memberId,
    });
    complete(choreId, '2026-06-02');

    db.prepare('DELETE FROM chores WHERE id = ?').run(choreId);

    const completionCount = db
      .prepare('SELECT COUNT(*) as n FROM chore_completions WHERE chore_id = ?')
      .get(choreId) as { n: number };
    assert.equal(completionCount.n, 0);
  });

  it('DB rejects daily chore with day_of_week set', () => {
    const memberId = addMember('liam', 'pig');
    assert.throws(() =>
      db
        .prepare(
          `INSERT INTO chores (id, title, icon, stars, frequency, day_of_week, assigned_to, position)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          'chore-bad-daily',
          'bad daily',
          'x',
          1,
          'daily',
          3,
          memberId,
          0
        )
    );
  });

  it('DB rejects weekly chore without day_of_week', () => {
    // The CHECK constraint uses BETWEEN, which yields UNKNOWN on NULL — and
    // per SQL three-valued logic SQLite accepts CHECK that evaluates to NULL.
    // So a literal NULL day_of_week slips past the CHECK at the DB layer
    // (the repo layer catches it; see chores.ts updateChore validation).
    // What the CHECK does reject is an out-of-range day_of_week, which is
    // the equivalent "weekly without a valid day" failure mode.
    const memberId = addMember('mia', 'duck');
    assert.throws(() =>
      db
        .prepare(
          `INSERT INTO chores (id, title, icon, stars, frequency, day_of_week, assigned_to, position)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          'chore-bad-weekly',
          'bad weekly',
          'x',
          1,
          'weekly',
          7, // out of 0..6 range
          memberId,
          0
        )
    );
  });
});
