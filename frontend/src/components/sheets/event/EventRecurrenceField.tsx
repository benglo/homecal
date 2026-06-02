import { REPEAT_LABELS, type RepeatFreq } from '../../../core/util/rrule';
import { Field } from '../fields';
import { TextInput } from '../fields';
import { TogglePillGroup } from '../../ui/TogglePill';

const FREQS: RepeatFreq[] = ['none', 'daily', 'weekly', 'monthly'];

interface Props {
  freq: RepeatFreq;
  until: string;
  onFreqChange: (next: RepeatFreq) => void;
  onUntilChange: (next: string) => void;
  /** Show the "Changes apply to the whole series." hint when editing a recurring event. */
  hint?: string;
}

/** Recurrence picker: frequency pills + until-date input.
 *  The rrule string is built outside (via buildRRule(freq, until)) at save time —
 *  this component only manages the two inputs. */
export function EventRecurrenceField({ freq, until, onFreqChange, onUntilChange, hint }: Props) {
  return (
    <Field label="Repeat" hint={hint}>
      <TogglePillGroup
        options={FREQS.map((f) => ({ value: f, label: REPEAT_LABELS[f] }))}
        value={freq}
        onChange={onFreqChange}
        variant="solid"
        pillStyle={{ minHeight: 48 }}
        className="flex flex-wrap gap-2"
      />
      {freq !== 'none' && <div style={{ height: 12 }} />}
      {freq !== 'none' && (
        <label className="flex items-center gap-3">
          <span className="text-text-muted" style={{ width: 48, fontSize: 14 }}>
            Until
          </span>
          <TextInput type="date" value={until} onChange={(e) => onUntilChange(e.target.value)} />
        </label>
      )}
    </Field>
  );
}
