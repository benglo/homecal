import type { Category } from '../../core/model/types';
import type { SlotSelection } from '../calendar/slotSelection';
import { useEventMutations } from '../../core/hooks/useMutations';
import { Sheet } from './Sheet';
import { EventQuickAddForm } from './EventQuickAddForm';

interface Props {
  open: boolean;
  onClose: () => void;
  categories: Category[];
  /** Prefill from a grid tap/drag or defaultSlot() for the +/FAB path. */
  slot: SlotSelection | null;
  /** Dinner chip tapped — host swaps to the DinnerEditorSheet for this date. */
  onDinner: (date: string) => void;
}

/** Wall/phone shell for the unified create form (desktop gets a popover in P3). */
export function QuickAddSheet({ open, onClose, categories, slot, onDinner }: Props) {
  const { create } = useEventMutations();

  if (!open || !slot) return null;

  return (
    <Sheet open onClose={onClose} title="Quick add">
      <EventQuickAddForm
        key={`${slot.date}-${slot.time ?? 'allday'}`}
        categories={categories}
        slot={slot}
        onSubmit={(body) => {
          create.mutate(body);
          onClose();
        }}
        onDinner={onDinner}
        onCancel={onClose}
      />
    </Sheet>
  );
}
