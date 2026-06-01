import { useState } from 'react';
import { DateTime } from 'luxon';
import type { EventOccurrence, WallView } from '../core/model/types';
import { useClock } from '../core/hooks/useClock';
import { useWallTheme } from '../core/hooks/useTheme';
import { useIdleReset } from '../core/hooks/useIdleReset';
import { useCategories, useDinners, useEvents, usePhotos, byId } from '../core/hooks/useData';
import { useScreensaver } from '../components/screensaver/useScreensaver';
import { Screensaver } from '../components/screensaver/Screensaver';
import { eventWindow, weekDates, nowBne, toInputDate } from '../core/util/time';
import { HeroBand } from '../components/hero/HeroBand';
import { AgendaView } from '../components/calendar/AgendaView';
import { GridCalendar } from '../components/calendar/GridCalendar';
import { ControlBar } from '../components/controls/ControlBar';
import { AddChooser } from '../components/controls/AddChooser';
import { DayDetailSheet } from '../components/sheets/DayDetailSheet';
import { QuickAddSheet } from '../components/sheets/QuickAddSheet';
import { DinnerEditorSheet } from '../components/sheets/DinnerEditorSheet';
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

  const photosQ = usePhotos();
  const screensaver = useScreensaver(photosQ.data);

  const cats = byId(categoriesQ.data);
  const occurrences = eventsQ.data ?? [];
  const dinners = dinnersQ.data ?? [];

  const [detailDate, setDetailDate] = useState<string | null>(null);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [quickAddCategoryId, setQuickAddCategoryId] = useState<string | null>(null);
  const [dinnerEditorOpen, setDinnerEditorOpen] = useState(false);

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

  const dismissAll = () => {
    setChooserOpen(false);
    setQuickAddCategoryId(null);
    setDinnerEditorOpen(false);
    setDetailDate(null);
  };

  useIdleReset(90_000, () => {
    setView('agenda');
    setAnchor(now.startOf('day'));
    dismissAll();
  });

  const openDetail = (date: string) => {
    dismissAll();
    setDetailDate(date);
  };
  const openChooser = () => {
    dismissAll();
    setChooserOpen(true);
  };

  const onTap = (occ: EventOccurrence) => openDetail(dayKey(occ.start));
  const detailDinner = detailDate ? dinners.find((d) => d.date === detailDate)?.meal : undefined;

  const todayStr = toInputDate(nowBne().toUTC().toISO()!);
  const todayMeal = dinners.find((d) => d.date === todayStr)?.meal ?? '';

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
        anchor={anchor}
        onView={setView}
        onPrev={() => step(-1)}
        onNext={() => step(1)}
        onToday={goToday}
        isToday={isToday}
        onQuickAdd={openChooser}
      />

      <AddChooser
        open={chooserOpen}
        onClose={() => setChooserOpen(false)}
        categories={categoriesQ.data ?? []}
        onCategory={(id) => {
          dismissAll();
          setQuickAddCategoryId(id);
        }}
        onDinner={() => {
          dismissAll();
          setDinnerEditorOpen(true);
        }}
      />

      <DayDetailSheet
        open={detailDate !== null}
        onClose={() => setDetailDate(null)}
        date={detailDate}
        occurrences={occurrences}
        categories={cats}
        dinner={detailDinner}
      />

      <QuickAddSheet
        open={quickAddCategoryId !== null}
        onClose={() => setQuickAddCategoryId(null)}
        categories={categoriesQ.data ?? []}
        defaultCategoryId={quickAddCategoryId ?? undefined}
      />

      <DinnerEditorSheet
        open={dinnerEditorOpen}
        onClose={() => setDinnerEditorOpen(false)}
        date={todayStr}
        currentMeal={todayMeal}
      />

      <VirtualKeyboard />

      {screensaver.active && screensaver.queue.length > 0 && (
        <Screensaver
          queue={screensaver.queue}
          index={screensaver.index}
          advance={screensaver.advance}
          skipPhoto={screensaver.skipPhoto}
          dismiss={screensaver.dismiss}
        />
      )}
    </div>
  );
}
