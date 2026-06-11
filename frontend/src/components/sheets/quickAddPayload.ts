import { DateTime } from 'luxon';
import { ZONE } from '../../core/util/time';
import type { EventCreateInput } from '../../core/model/types';

/** Everything the unified Quick Add form holds; Brisbane-local values. */
export interface QuickAddDraft {
  categoryId: string;
  title: string;
  date: string; // yyyy-LL-dd
  time: string; // HH:mm — ignored when allDay
  endTime: string; // HH:mm — ignored when allDay
  endDate?: string; // multi-day all-day only
  allDay: boolean;
}

/** Draft → POST /api/events body, or null when not yet submittable. */
export function buildQuickAddPayload(d: QuickAddDraft): EventCreateInput | null {
  const title = d.title.trim();
  if (!title || !d.categoryId) return null;

  if (d.allDay) {
    return { categoryId: d.categoryId, title, start: d.date, end: d.endDate ?? d.date, allDay: true };
  }

  const startLocal = DateTime.fromISO(`${d.date}T${d.time}`, { zone: ZONE });
  let endLocal = DateTime.fromISO(`${d.date}T${d.endTime}`, { zone: ZONE });
  // A drag can't produce end <= start, but manual time edits can; treat it as
  // crossing midnight rather than rejecting (matches user intent for 23:30→00:30).
  if (endLocal <= startLocal) endLocal = endLocal.plus({ days: 1 });

  return {
    categoryId: d.categoryId,
    title,
    start: startLocal.toUTC().toISO({ suppressMilliseconds: true })!,
    end: endLocal.toUTC().toISO({ suppressMilliseconds: true })!,
    allDay: false,
  };
}
