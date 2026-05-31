import { useState } from 'react';
import { DateTime } from 'luxon';
import { useDinnerMutations } from '../../core/hooks/useMutations';
import { ZONE } from '../../core/util/time';
import { Sheet } from './Sheet';
import { Button } from '../primitives/Button';
import { Field, TextInput } from './fields';

interface Props {
  open: boolean;
  onClose: () => void;
  date: string | null; // yyyy-MM-dd
  currentMeal: string;
}

/** Set or clear one day's dinner. Mirrors the WeekMealStrip / DinnerHero. */
export function DinnerEditorSheet({ open, onClose, date, currentMeal }: Props) {
  const { set, clear } = useDinnerMutations();
  const [meal, setMeal] = useState(currentMeal);

  if (!open || !date) return null;

  const pretty = DateTime.fromISO(date, { zone: ZONE }).toFormat('cccc d LLLL');

  const save = () => {
    const v = meal.trim();
    if (v) set.mutate({ date, meal: v }, { onSuccess: onClose });
    else clear.mutate(date, { onSuccess: onClose });
  };

  const actions = (
    <>
      {currentMeal && (
        <Button variant="danger" onClick={() => clear.mutate(date, { onSuccess: onClose })} style={{ marginRight: 'auto' }}>
          Clear
        </Button>
      )}
      <Button variant="ghost" onClick={onClose}>
        Cancel
      </Button>
      <Button variant="primary" onClick={save}>
        Save
      </Button>
    </>
  );

  return (
    <Sheet open onClose={onClose} title={`Dinner · ${pretty}`} actions={actions}>
      <Field label="Meal">
        <TextInput
          value={meal}
          onChange={(e) => setMeal(e.target.value)}
          placeholder="What's for dinner?"
          autoFocus
          onKeyDown={(e) => e.key === 'Enter' && save()}
        />
      </Field>
    </Sheet>
  );
}
