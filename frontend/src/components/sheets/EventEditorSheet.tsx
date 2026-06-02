import type { Category, EventOccurrence } from '../../core/model/types';
import { EventEditorBody } from './event/EventEditorBody';

interface Props {
  open: boolean;
  onClose: () => void;
  categories: Category[];
  /** Present → edit that occurrence's series; absent → create. */
  occurrence?: EventOccurrence | null;
  /** Create prefill from a wall/FC selection (UTC ISO). */
  prefill?: { start?: string; end?: string; allDay?: boolean };
}

/** Thin shell: gates on `open` so the inner component's hooks only run when actually
 *  visible (avoids fetching the master when the sheet is closed). */
export function EventEditorSheet({ open, onClose, categories, occurrence, prefill }: Props) {
  if (!open) return null;
  return (
    <EventEditorBody
      onClose={onClose}
      categories={categories}
      occurrence={occurrence ?? null}
      prefill={prefill}
    />
  );
}
