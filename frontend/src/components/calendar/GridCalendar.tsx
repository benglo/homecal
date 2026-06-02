import { useMemo } from 'react';
import FullCalendar from '@fullcalendar/react';
import type { EventInput } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import type { Category, EventOccurrence } from '../../core/model/types';
import { makeRenderChip } from './renderChip';

interface Props {
  view: 'week' | 'month';
  date: string; // ISO date for the FC instance
  occurrences: EventOccurrence[];
  categories: Map<string, Category>;
  onEventClick?: (occ: EventOccurrence) => void;
}

/** FullCalendar week (timeGrid) / month (dayGrid). MIT plugins only.
 *  Built-in toolbar disabled — nav is driven by our ControlBar. */
export function GridCalendar({ view, date, occurrences, categories, onEventClick }: Props) {
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

  return (
    <div className="flex-1 overflow-hidden" style={{ padding: '12px 16px' }}>
      <FullCalendar
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
        events={events}
        eventContent={renderChip}
        eventClick={(arg) => onEventClick?.(arg.event.extendedProps.occ as EventOccurrence)}
      />
    </div>
  );
}
