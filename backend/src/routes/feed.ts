import type { FastifyInstance } from 'fastify';
import ical, { ICalCalendarMethod, type ICalEventData } from 'ical-generator';
import type { Category, EventMaster, Dinner } from '../model/types';
import type { CancelledEx } from '../repos/events';
import { listAllMasters, listAllCancelledExceptions } from '../repos/events';
import { listCategories } from '../repos/categories';
import { listAllDinners } from '../repos/dinners';

/* ── helpers ─────────────────────────────────────────────────── */

function toIcalDate(iso: string): string {
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00Z' : iso);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

function toIcalDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z';
}

function nextDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/* ── buildFeed ───────────────────────────────────────────────── */

/**
 * Build an iCal string from pre-fetched data. Pure function — no DB access.
 */
export function buildFeed(
  categories: Category[],
  masters: EventMaster[],
  exceptions: CancelledEx[],
  dinners: Dinner[],
): string {
  const cal = ical({
    prodId: '//homecal//EN',
    method: ICalCalendarMethod.PUBLISH,
    scale: 'GREGORIAN',
    x: { 'X-WR-TIMEZONE': 'Australia/Brisbane' },
  });

  // Index categories by id for fast lookup
  const catById = new Map(categories.map((c) => [c.id, c]));

  // Group exceptions by eventId
  const exByEvent = new Map<string, CancelledEx[]>();
  for (const ex of exceptions) {
    const list = exByEvent.get(ex.eventId);
    if (list) {
      list.push(ex);
    } else {
      exByEvent.set(ex.eventId, [ex]);
    }
  }

  // Events
  for (const master of masters) {
    try {
      addEventToCalendar(cal, master, catById, exByEvent);
    } catch {
      /* per-event try/catch: one bad record must not break the feed */
    }
  }

  // Dinners
  for (const dinner of dinners) {
    try {
      addDinnerToCalendar(cal, dinner);
    } catch {
      /* per-dinner try/catch */
    }
  }

  return cal.toString();
}

function addEventToCalendar(
  cal: ReturnType<typeof ical>,
  master: EventMaster,
  catById: Map<string, Category>,
  exByEvent: Map<string, CancelledEx[]>,
): void {
  const category = catById.get(master.categoryId);

  const eventData: ICalEventData = {
    id: `${master.id}@homecal`,
    start: new Date(master.start),
    end: new Date(master.end),
    allDay: master.allDay,
    summary: master.title,
    lastModified: new Date(master.updatedAt),
    location: master.location ? { title: master.location } : undefined,
  };

  const evt = cal.createEvent(eventData);

  if (category) {
    evt.createCategory({ name: category.name });
  }

  // RRULE + EXDATE: use the raw-string path through ical-generator.
  // When given a multi-line string, the library passes it through verbatim
  // (splitting by \n, rejoining with \r\n). We append EXDATE lines to the
  // RRULE string so they're included in the output.
  if (master.rrule) {
    const eventExceptions = exByEvent.get(master.id) || [];
    const rruleStr = master.rrule.startsWith('RRULE:')
      ? master.rrule
      : `RRULE:${master.rrule}`;

    if (eventExceptions.length > 0) {
      const exdateLines = eventExceptions.map((ex) => {
        if (master.allDay) {
          return `EXDATE;VALUE=DATE:${toIcalDate(ex.occurrenceDate)}`;
        }
        return `EXDATE:${toIcalDateTime(ex.occurrenceDate)}`;
      });
      evt.repeating(rruleStr + '\n' + exdateLines.join('\n'));
    } else {
      evt.repeating(rruleStr);
    }
  }
}

function addDinnerToCalendar(
  cal: ReturnType<typeof ical>,
  dinner: Dinner,
): void {
  const endDate = nextDate(dinner.date);

  const evt = cal.createEvent({
    id: `dinner-${dinner.date}@homecal`,
    start: new Date(dinner.date),
    end: new Date(endDate),
    allDay: true,
    summary: `Dinner: ${dinner.meal}`,
    lastModified: new Date(dinner.updatedAt),
  });

  evt.createCategory({ name: 'Dinner' });
}

/* ── Fastify plugin ──────────────────────────────────────────── */

export async function feedRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/feed.ics', async (_req, reply) => {
    const categories = listCategories();
    const masters = listAllMasters();
    const exceptions = listAllCancelledExceptions();
    const dinners = listAllDinners();

    const icsBody = buildFeed(categories, masters, exceptions, dinners);

    return reply
      .header('Content-Type', 'text/calendar; charset=utf-8')
      .header('Content-Disposition', 'inline; filename="homecal.ics"')
      .header('Cache-Control', 'no-cache')
      .send(icsBody);
  });
}
