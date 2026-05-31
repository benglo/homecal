import { useState } from 'react';
import { DateTime } from 'luxon';
import type { EventOccurrence, WallView } from '../core/model/types';
import { useClock } from '../core/hooks/useClock';
import { useWallTheme } from '../core/hooks/useTheme';
import { useCategories, useDinners, useEvents, byId } from '../core/hooks/useData';
import { eventWindow, weekDates } from '../core/util/time';
import { HeroBand } from '../components/hero/HeroBand';
import { AgendaView } from '../components/calendar/AgendaView';
import { GridCalendar } from '../components/calendar/GridCalendar';
import { ControlBar } from '../components/controls/ControlBar';

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

  const step = (dir: 1 | -1) =>
    setAnchor((a) =>
      view === 'agenda' ? a.plus({ days: 10 * dir }) : view === 'week' ? a.plus({ weeks: dir }) : a.plus({ months: dir })
    );
  const goToday = () => setAnchor(now.startOf('day'));
  const isToday = anchor.hasSame(now, 'day') && (view !== 'month' || anchor.hasSame(now, 'month'));

  const onTap = (_occ: EventOccurrence) => {
    /* Day-detail sheet / editor wired in M3. */
  };

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ filter: 'brightness(var(--kiosk-brightness))' }}>
      <HeroBand
        now={now}
        weekDays={week.days}
        dinners={dinnersQ.data ?? []}
        dataUpdatedAt={dinnersQ.dataUpdatedAt}
        isError={dinnersQ.isError}
      />

      {view === 'agenda' ? (
        <AgendaView occurrences={occurrences} categories={cats} now={now} onTap={onTap} />
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
        onQuickAdd={() => {
          /* QuickAddSheet in M3 */
        }}
      />
    </div>
  );
}
