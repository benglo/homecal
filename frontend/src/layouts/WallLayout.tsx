import { useCallback, useReducer, useState } from 'react';
import { DateTime } from 'luxon';
import type { EventOccurrence, WallView } from '../core/model/types';
import { useClock } from '../core/hooks/useClock';
import { useWallTheme } from '../core/hooks/useTheme';
import { useIdleReset } from '../core/hooks/useIdleReset';
import { useCategories, useDinners, useEvents, usePhotos, useWeather, byId } from '../core/hooks/useData';
import { useScreensaver } from '../components/screensaver/useScreensaver';
import { Screensaver } from '../components/screensaver/Screensaver';
import { useSsePoke } from '../core/hooks/useRealtime';
import { VoiceOverlay } from '../components/voice/VoiceOverlay';
import { reduceOverlay, initialOverlay, pokeToAction } from '../components/voice/voiceState';
import { eventWindow, weekDates, nowBne } from '../core/util/time';
import { HeroBand } from '../components/hero/HeroBand';
import { AgendaView } from '../components/calendar/AgendaView';
import { GridCalendar } from '../components/calendar/GridCalendar';
import { ChoresBoard } from '../components/chores/ChoresBoard';
import { ControlBar } from '../components/controls/ControlBar';
import { defaultSlot, type SlotSelection } from '../components/calendar/slotSelection';
import { DayDetailSheet } from '../components/sheets/DayDetailSheet';
import { QuickAddSheet } from '../components/sheets/QuickAddSheet';
import { DinnerEditorSheet } from '../components/sheets/DinnerEditorSheet';
import { dayKey } from '../core/util/time';
import { VirtualKeyboard } from '../components/keyboard/VirtualKeyboard';
import { TimerStack } from '../components/timers/TimerStack';

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
  const weatherQ = useWeather();

  // Voice overlay: SSE-driven state machine. While non-idle, suspend the wall's
  // idle reset + screensaver so the user can finish their utterance in peace.
  const [overlay, dispatch] = useReducer(reduceOverlay, undefined, initialOverlay);
  const [voiceActive, setVoiceActive] = useState(false);
  // pokeToAction is the trust boundary: rejects unknown kinds, missing
  // intents, malformed payloads. `mute_changed` falls through here too —
  // useVoiceStatus's query invalidation picks it up instead.
  useSsePoke<unknown>(
    'voice',
    useCallback((p) => {
      const action = pokeToAction(p);
      if (action) dispatch(action);
    }, []),
  );

  const screensaver = useScreensaver(photosQ.data, voiceActive);

  const cats = byId(categoriesQ.data);
  const occurrences = eventsQ.data ?? [];
  const dinners = dinnersQ.data ?? [];

  const [detailDate, setDetailDate] = useState<string | null>(null);
  const [slotTarget, setSlotTarget] = useState<SlotSelection | null>(null);
  const [dinnerDate, setDinnerDate] = useState<string | null>(null);

  // Wall staleness = the worse of events + dinners (events is the primary data).
  const oldest = Math.min(eventsQ.dataUpdatedAt || Infinity, dinnersQ.dataUpdatedAt || Infinity);
  const dataUpdatedAt = Number.isFinite(oldest) ? oldest : 0;
  const dataIsError = eventsQ.isError || dinnersQ.isError;

  const step = (dir: 1 | -1) => {
    if (view === 'chores') return;
    setAnchor((a) =>
      view === 'agenda' ? a.plus({ days: dir }) : view === 'week' ? a.plus({ weeks: dir }) : a.plus({ months: dir })
    );
  };
  const goToday = () => setAnchor(now.startOf('day'));
  const isToday = anchor.hasSame(now, 'day') && (view !== 'month' || anchor.hasSame(now, 'month'));

  const dismissAll = () => {
    setSlotTarget(null);
    setDinnerDate(null);
    setDetailDate(null);
  };

  useIdleReset(
    90_000,
    () => {
      if (dinnerDate !== null) return; // planning in progress — let the user finish
      setView('agenda');
      setAnchor(now.startOf('day'));
      dismissAll();
    },
    voiceActive,
  );

  const openDetail = (date: string) => {
    dismissAll();
    setDetailDate(date);
  };
  const openQuickAdd = (slot: SlotSelection) => {
    dismissAll();
    setSlotTarget(slot);
  };

  const onTap = (occ: EventOccurrence) => openDetail(dayKey(occ.start));
  const detailDinner = detailDate ? dinners.find((d) => d.date === detailDate)?.meal : undefined;

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ filter: 'brightness(var(--kiosk-brightness))' }}>
      <HeroBand
        now={now}
        weekDays={week.days}
        dinners={dinners}
        dataUpdatedAt={dataUpdatedAt}
        isError={dataIsError}
        weather={weatherQ.data}
        onTapDay={(date) => {
          dismissAll();
          setDinnerDate(date);
        }}
      />

      {view === 'agenda' ? (
        <AgendaView occurrences={occurrences} categories={cats} now={now} loading={eventsQ.isPending} onTap={onTap} />
      ) : view === 'chores' ? (
        <ChoresBoard />
      ) : (
        <GridCalendar
          view={view}
          date={anchor.toUTC().toISO()!}
          occurrences={occurrences}
          categories={cats}
          onEventClick={onTap}
          onSlotSelect={openQuickAdd}
          selectionOpen={slotTarget !== null}
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
        onQuickAdd={() => openQuickAdd(defaultSlot(nowBne()))}
        voiceState={overlay}
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
        open={slotTarget !== null}
        onClose={() => setSlotTarget(null)}
        categories={categoriesQ.data ?? []}
        slot={slotTarget}
        onDinner={(date) => {
          dismissAll();
          setDinnerDate(date);
        }}
      />

      <DinnerEditorSheet
        key={dinnerDate ?? 'closed'}
        open={dinnerDate !== null}
        onClose={() => setDinnerDate(null)}
        initialDate={dinnerDate}
      />

      <VirtualKeyboard />

      <TimerStack />

      <VoiceOverlay state={overlay} dispatch={dispatch} onActiveChange={setVoiceActive} />

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
