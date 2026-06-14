// frontend/src/components/calendar/GridCalendar.tsx
import { useEffect, useMemo, useRef } from 'react';
import FullCalendar from '@fullcalendar/react';
import type { EventInput } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import type { Category, EventOccurrence } from '../../core/model/types';
import { nowBne } from '../../core/util/time';
import { makeRenderChip } from './renderChip';
import { mapSlotSelection, mapDateClick, type SlotSelection } from './slotSelection';

interface Props {
  view: 'week' | 'month';
  date: string; // ISO date for the FC instance
  occurrences: EventOccurrence[];
  categories: Map<string, Category>;
  onEventClick?: (occ: EventOccurrence) => void;
  /** Enables tap/drag-to-create. Absent → grid is read-only as before. */
  onSlotSelect?: (sel: SlotSelection) => void;
  /** Keep FC's selection highlight while the create form is open; flipping
   *  back to false clears the ghost. */
  selectionOpen?: boolean;
}

/** FullCalendar week (timeGrid) / month (dayGrid). MIT plugins only.
 *  Built-in toolbar disabled — nav is driven by our ControlBar. */
export function GridCalendar({ view, date, occurrences, categories, onEventClick, onSlotSelect, selectionOpen }: Props) {
  const calRef = useRef<FullCalendar>(null);

  const events: EventInput[] = useMemo(
    () =>
      occurrences.map((o) => ({
        id: o.id,
        title: o.title,
        start: o.start,
        end: o.end,
        allDay: o.allDay,
        extendedProps: { categoryId: o.categoryId, occ: o },
      })),
    [occurrences]
  );
  const renderChip = useMemo(() => makeRenderChip(categories), [categories]);

  // unselectAuto is off so the ghost survives the sheet opening; we clear it
  // ourselves when the form closes.
  useEffect(() => {
    if (!selectionOpen) calRef.current?.getApi().unselect();
  }, [selectionOpen]);

  return (
    <div className="flex-1 overflow-hidden" style={{ padding: '12px 16px' }}>
      <FullCalendar
        ref={calRef}
        key={`${view}-${date}`}
        plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
        initialView={view === 'week' ? 'timeGridWeek' : 'dayGridMonth'}
        initialDate={date}
        headerToolbar={false}
        locale="en-au"
        firstDay={1}
        height="100%"
        expandRows
        nowIndicator
        allDaySlot
        slotMinTime="06:00:00"
        slotMaxTime="22:00:00"
        dayMaxEvents={3}
        fixedWeekCount={false}
        selectable={!!onSlotSelect}
        selectMirror
        unselectAuto={false}
        // Touch: a plain tap fires dateClick; a long-press (150ms) + drag fires
        // select for an explicit range. Mouse: selectMinDistance keeps a click
        // from also firing select (it would double with dateClick) — a real drag
        // still selects a range.
        selectLongPressDelay={150}
        selectMinDistance={5}
        events={events}
        eventContent={renderChip}
        eventClick={(arg) => onEventClick?.(arg.event.extendedProps.occ as EventOccurrence)}
        select={(arg) => onSlotSelect?.(mapSlotSelection(arg, nowBne()))}
        dateClick={(arg) => onSlotSelect?.(mapDateClick(arg, nowBne()))}
      />
    </div>
  );
}
