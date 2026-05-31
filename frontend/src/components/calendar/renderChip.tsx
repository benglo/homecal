import type { EventContentArg } from '@fullcalendar/core';
import type { Category } from '../../core/model/types';
import { chipFill } from '../../core/util/color';
import { iconFor } from '../../core/util/icons';

/** Shared FullCalendar eventContent → colour + icon + label (matches CategoryChip). */
export function makeRenderChip(categories: Map<string, Category>) {
  return function renderChip(arg: EventContentArg) {
    const cat = categories.get(arg.event.extendedProps.categoryId as string);
    const color = cat?.color ?? 'var(--c-uncat)';
    const Icon = iconFor(cat?.icon);
    return (
      <div
        className="flex items-center gap-1.5 overflow-hidden rounded-md"
        style={{ padding: '3px 6px', background: chipFill(color, 0.16), borderLeft: `4px solid ${color}` }}
      >
        <Icon size={12} strokeWidth={2.2} style={{ color, flex: 'none' }} />
        {arg.timeText && <span className="font-mono shrink-0" style={{ fontSize: 11, opacity: 0.85 }}>{arg.timeText}</span>}
        <span className="truncate font-semibold" style={{ fontSize: 13 }}>{arg.event.title}</span>
      </div>
    );
  };
}
