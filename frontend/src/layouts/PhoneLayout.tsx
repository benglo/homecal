import { useState } from 'react';
import { DateTime } from 'luxon';
import { ChevronLeft, ChevronRight, Utensils } from 'lucide-react';
import type { Category, EventOccurrence } from '../core/model/types';
import { useClock } from '../core/hooks/useClock';
import { usePhoneTheme } from '../core/hooks/useTheme';
import { useCategories, useDinners, useEvents, byId } from '../core/hooks/useData';
import { eventWindow, weekDates, ZONE } from '../core/util/time';
import { AgendaView } from '../components/calendar/AgendaView';
import { GridCalendar } from '../components/calendar/GridCalendar';
import { PhoneHeader } from '../components/controls/PhoneHeader';
import { TabBar, type PhoneTab } from '../components/controls/TabBar';
import { Fab } from '../components/controls/Fab';
import { CategoryManager } from '../components/manage/CategoryManager';
import { DinnerWeekEditor } from '../components/manage/DinnerWeekEditor';
import { EventEditorSheet } from '../components/sheets/EventEditorSheet';
import { CategoryEditorSheet } from '../components/sheets/CategoryEditorSheet';
import { DinnerEditorSheet } from '../components/sheets/DinnerEditorSheet';

/** Edit-heavy phone surface: Agenda · Week · Manage tabs, Fab create, OS day/night. */
export function PhoneLayout() {
  const now = useClock();
  usePhoneTheme();

  const [tab, setTab] = useState<PhoneTab>('agenda');
  const [anchor, setAnchor] = useState<DateTime>(() => now.startOf('day'));

  // Editor sheet state.
  const [eventTarget, setEventTarget] = useState<{ occ: EventOccurrence | null } | null>(null);
  const [categoryTarget, setCategoryTarget] = useState<{ cat: Category | null } | null>(null);
  const [dinnerTarget, setDinnerTarget] = useState<{ date: string; meal: string } | null>(null);

  const view = tab === 'week' ? 'week' : 'agenda';
  const win = eventWindow(view, anchor);
  const week = weekDates(now);
  const today = now.toFormat('yyyy-LL-dd');

  const categoriesQ = useCategories();
  const eventsQ = useEvents(win.startIso, win.endIso);
  const dinnersQ = useDinners(week.start, week.end);

  const cats = byId(categoriesQ.data);
  const categories = categoriesQ.data ?? [];
  const occurrences = eventsQ.data ?? [];
  const dinners = dinnersQ.data ?? [];
  const tonight = dinners.find((d) => d.date === today)?.meal ?? '';

  const stepWeek = (dir: 1 | -1) => setAnchor((a) => a.plus({ weeks: dir }));

  const openFab = () => {
    if (tab === 'manage') setCategoryTarget({ cat: null });
    else setEventTarget({ occ: null });
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PhoneHeader now={now} dataUpdatedAt={eventsQ.dataUpdatedAt} isError={eventsQ.isError} />

      <main className="flex-1 flex flex-col overflow-hidden">
        {tab === 'agenda' && (
          <>
            <button
              type="button"
              onClick={() => setDinnerTarget({ date: today, meal: tonight })}
              className="flex items-center gap-3 shrink-0 text-left border-b border-border"
              style={{ padding: '12px 16px', background: 'var(--accent-weak)', color: 'var(--accent-ink)' }}
            >
              <Utensils size={18} className="shrink-0" />
              <span className="flex-1 min-w-0">
                <span className="block font-semibold" style={{ fontSize: 12, opacity: 0.8 }}>
                  TONIGHT
                </span>
                <span className="block truncate" style={{ fontSize: 16, fontWeight: 600 }}>
                  {tonight || 'No dinner planned — tap to add'}
                </span>
              </span>
            </button>
            <AgendaView occurrences={occurrences} categories={cats} now={now} density="phone" loading={eventsQ.isPending} onTap={(occ) => setEventTarget({ occ })} />
          </>
        )}

        {tab === 'week' && (
          <>
            <div className="flex items-center justify-between shrink-0 border-b border-border" style={{ padding: '8px 16px' }}>
              <button type="button" aria-label="Previous week" onClick={() => stepWeek(-1)} className="grid place-items-center text-text-muted" style={{ width: 40, height: 40 }}>
                <ChevronLeft size={22} />
              </button>
              <span className="font-semibold text-text" style={{ fontSize: 15 }}>
                {anchor.setZone(ZONE).startOf('week').toFormat('d LLL')} – {anchor.setZone(ZONE).startOf('week').plus({ days: 6 }).toFormat('d LLL')}
              </span>
              <button type="button" aria-label="Next week" onClick={() => stepWeek(1)} className="grid place-items-center text-text-muted" style={{ width: 40, height: 40 }}>
                <ChevronRight size={22} />
              </button>
            </div>
            <GridCalendar view="week" date={anchor.toUTC().toISO()!} occurrences={occurrences} categories={cats} onEventClick={(occ) => setEventTarget({ occ })} />
          </>
        )}

        {tab === 'manage' && (
          <div className="flex-1 overflow-y-auto" style={{ padding: '16px' }}>
            <DinnerWeekEditor
              weekDays={week.days}
              dinners={dinners}
              today={today}
              onTapDay={(date, meal) => setDinnerTarget({ date, meal })}
            />
            <CategoryManager categories={categories} onEdit={(cat) => setCategoryTarget({ cat })} />
          </div>
        )}
      </main>

      {!eventTarget && !categoryTarget && !dinnerTarget && (
        <Fab onClick={openFab} label={tab === 'manage' ? 'Add category' : 'Add event'} />
      )}

      <TabBar value={tab} onChange={setTab} />

      {/* Sheets */}
      {eventTarget && (
        <EventEditorSheet open onClose={() => setEventTarget(null)} categories={categories} occurrence={eventTarget.occ} />
      )}
      {categoryTarget && (
        <CategoryEditorSheet open onClose={() => setCategoryTarget(null)} category={categoryTarget.cat} />
      )}
      {dinnerTarget && (
        <DinnerEditorSheet open onClose={() => setDinnerTarget(null)} date={dinnerTarget.date} currentMeal={dinnerTarget.meal} />
      )}
    </div>
  );
}
