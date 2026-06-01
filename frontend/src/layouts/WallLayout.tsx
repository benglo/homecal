import { useState } from 'react';
import { DateTime } from 'luxon';
import type { EventOccurrence, WallView } from '../core/model/types';
import { useClock } from '../core/hooks/useClock';
import { useWallTheme } from '../core/hooks/useTheme';
import { useIdleReset } from '../core/hooks/useIdleReset';
import { useCategories, useDinners, useEvents, byId } from '../core/hooks/useData';
import { eventWindow, weekDates } from '../core/util/time';
import { HeroBand } from '../components/hero/HeroBand';
import { AgendaView } from '../components/calendar/AgendaView';
import { GridCalendar } from '../components/calendar/GridCalendar';
import { ControlBar } from '../components/controls/ControlBar';
import { DayDetailSheet } from '../components/sheets/DayDetailSheet';
import { QuickAddSheet } from '../components/sheets/QuickAddSheet';
import { dayKey } from '../core/util/time';
import { VirtualKeyboard } from '../components/keyboard/VirtualKeyboard';

/** The wall: hero band (200) · calendar surface (flex) · control bar (72). */
export function WallLayout() {
  const now = useClock();
  useWallTheme(now);

  const [view, setView] = useState<WallView>('agenda');
  const [anchor, setAnchor] = useState<DateTime>(() => now.startOf('day'));

  const win = eventWindow(view, anchor);
  const week = weekDates(now);

  const categoriesQ = useCategories();
  const eventsQ = useEvents(win.startIso, win.endIso);
  const dinnersQ = useDinners(week.start, week.end);

  const cats = byId(categoriesQ.data);
  const occurrences = eventsQ.data ?? [];
  const dinners = dinnersQ.data ?? [];

  const [detailDate, setDetailDate] = useState<string | null>(null);
  const [quickAddOpen, setQuickAddOpen] = useState(false);

  // Wall staleness = the worse of events + dinners (events is the primary data).
  const oldest = Math.min(eventsQ.dataUpdatedAt || Infinity, dinnersQ.dataUpdatedAt || Infinity);
  const dataUpdatedAt = Number.isFinite(oldest) ? oldest : 0;
  const dataIsError = eventsQ.isError || dinnersQ.isError;

  const step = (dir: 1 | -1) =>
    setAnchor((a) =>
      view === 'agenda' ? a.plus({ days: 10 * dir }) : view === 'week' ? a.plus({ weeks: dir }) : a.plus({ months: dir })
    );
  const goToday = () => setAnchor(now.startOf('day'));
  const isToday = anchor.hasSame(now, 'day') && (view !== 'month' || anchor.hasSame(now, 'month'));

  // Return to the default glance (Agenda + today) and dismiss sheets after inactivity,
  // so the wall is never left stuck on a paged-away view someone walked away from.
  useIdleReset(90_000, () => {
    setView('agenda');
    setAnchor(now.startOf('day'));
    setDetailDate(null);
    setQuickAddOpen(false);
  });

  const onTap = (occ: EventOccurrence) => setDetailDate(dayKey(occ.start));
  const detailDinner = detailDate ? dinners.find((d) => d.date === detailDate)?.meal : undefined;

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ filter: 'brightness(var(--kiosk-brightness))' }}>
      <HeroBand
        now={now}
        weekDays={week.days}
        dinners={dinners}
        dataUpdatedAt={dataUpdatedAt}
        isError={dataIsError}
      />

      {view === 'agenda' ? (
        <AgendaView occurrences={occurrences} categories={cats} now={now} loading={eventsQ.isPending} onTap={onTap} />
      ) : (
        <GridCalendar
          view={view}
          date={anchor.toUTC().toISO()!}
          occurrences={occurrences}
          categories={cats}
          onEventClick={onTap}
        />
      )}

      <ControlBar
        view={view}
        onView={setView}
        onPrev={() => step(-1)}
        onNext={() => step(1)}
        onToday={goToday}
        isToday={isToday}
        categories={categoriesQ.data ?? []}
        onQuickAdd={() => setQuickAddOpen(true)}
      />

      <DayDetailSheet
        open={detailDate !== null}
        onClose={() => setDetailDate(null)}
        date={detailDate}
        occurrences={occurrences}
        categories={cats}
        dinner={detailDinner}
      />
      <QuickAddSheet open={quickAddOpen} onClose={() => setQuickAddOpen(false)} categories={categoriesQ.data ?? []} />
      <VirtualKeyboard />
    </div>
  );
}
