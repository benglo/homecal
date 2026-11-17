import { useState } from 'react';
import type { RoutineSettings, RoutineSettingsInput } from '../../core/model/types';
import { useRoutineSettings } from '../../core/hooks/useData';
import { useUpdateRoutineSettings } from '../../core/hooks/useMutations';
import { ApiError } from '../../core/api/client';
import { useBrisbaneDate } from '../../core/hooks/useBrisbaneDate';
import { TogglePillGroup } from '../ui/TogglePill';

const fieldStyle: React.CSSProperties = {
  minHeight: 40,
  padding: '6px 10px',
  fontSize: 16,
  borderRadius: 'var(--r-sm)',
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--text)',
};

const pill = { padding: '6px 12px', fontSize: 14 };

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1" style={{ paddingTop: 10 }}>
      <span style={{ fontSize: 14, fontWeight: 600 }}>{label}</span>
      {hint && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{hint}</span>}
      <div className="flex items-center gap-2 flex-wrap">{children}</div>
    </div>
  );
}

/** A number field that saves on blur, clamped to the server's limits. */
function MinutesField(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  onSave: (n: number) => void;
}) {
  return (
    <label className="flex items-center gap-2">
      <input
        type="number"
        inputMode="numeric"
        aria-label={props.label}
        min={props.min}
        max={props.max}
        defaultValue={props.value}
        key={props.value}
        onBlur={(e) => {
          const n = Math.round(Number(e.target.value));
          if (!Number.isFinite(n)) return;
          const clamped = Math.min(props.max, Math.max(props.min, n));
          if (clamped !== props.value) props.onSave(clamped);
          else e.target.value = String(props.value);
        }}
        style={{ ...fieldStyle, width: 80 }}
      />
      <span style={{ fontSize: 14 }}>minutes</span>
    </label>
  );
}

/** Add `days` to a 'YYYY-MM-DD' date (calendar arithmetic in UTC, no DST issues). */
function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** How the TV applies the routines. Every field saves as soon as it changes. */
export function RoutineSettingsPanel() {
  const q = useRoutineSettings();
  const update = useUpdateRoutineSettings();
  const [error, setError] = useState<string | null>(null);
  const today = useBrisbaneDate();
  const s: RoutineSettings | undefined = q.data;
  if (!s) return null;

  const save = (body: RoutineSettingsInput) => {
    setError(null);
    update.mutate(body, {
      onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not save that setting.'),
    });
  };
  const paused = s.morningsOffUntil != null && s.morningsOffUntil >= today;

  return (
    <div
      className="rounded-md border border-border flex flex-col"
      style={{ padding: '4px 12px 12px', background: 'var(--surface)', marginTop: 10 }}
    >
      <Row label="Bath" hint="Bed always turns the TV off.">
        <TogglePillGroup<'lock' | 'remind'>
          options={[
            { value: 'lock', label: 'Turns the TV off' },
            { value: 'remind', label: 'Reminder only' },
          ]}
          value={s.bathLocks ? 'lock' : 'remind'}
          onChange={(v) => save({ bathLocks: v === 'lock' })}
          ariaLabel="What bath time does"
          pillStyle={pill}
        />
      </Row>

      <Row label="School mornings" hint="Pause the morning checklist for holidays or sick days.">
        {paused ? (
          <>
            <span style={{ fontSize: 14 }}>Paused until {s.morningsOffUntil}</span>
            <button
              type="button"
              onClick={() => save({ morningsOffUntil: null })}
              style={{ ...fieldStyle, minHeight: 36, fontSize: 14 }}
            >
              Resume
            </button>
          </>
        ) : (
          <TogglePillGroup<number>
            options={[
              { value: 0, label: 'Today' },
              { value: 6, label: 'This week' },
              { value: 13, label: '2 weeks' },
            ]}
            value={null}
            onChange={(days) => save({ morningsOffUntil: addDays(today, days) })}
            ariaLabel="Pause school mornings"
            pillStyle={pill}
          />
        )}
        <input
          type="date"
          aria-label="Pause mornings until"
          min={today}
          value={paused ? (s.morningsOffUntil ?? '') : ''}
          onChange={(e) => e.target.value && save({ morningsOffUntil: e.target.value })}
          style={{ ...fieldStyle, minHeight: 36, fontSize: 14 }}
        />
      </Row>

      <Row label="Dinner reminder" hint={`The ${s.warnMinutes}-minute heads-up. "Dinner's ready" always works.`}>
        <TogglePillGroup<'on' | 'off'>
          options={[
            { value: 'on', label: 'On' },
            { value: 'off', label: 'Off' },
          ]}
          value={s.dinnerReminder ? 'on' : 'off'}
          onChange={(v) => save({ dinnerReminder: v === 'on' })}
          ariaLabel="Dinner reminder"
          pillStyle={pill}
        />
      </Row>

      <Row label="Heads-up before dinner, bath and bed" hint="0 turns the warning off.">
        <MinutesField label="Warning minutes" value={s.warnMinutes} min={0} max={60} onSave={(warnMinutes) => save({ warnMinutes })} />
      </Row>

      <Row label="Let a show finish for up to" hint="After bath or bed time, the TV waits for the episode to end.">
        <MinutesField label="Grace minutes" value={s.graceMinutes} min={0} max={60} onSave={(graceMinutes) => save({ graceMinutes })} />
      </Row>

      <Row label="Morning checklist starts" hint="How long before the leave time the TV asks for the checklist.">
        <MinutesField
          label="Morning window minutes"
          value={s.morningWindowMinutes}
          min={30}
          max={720}
          onSave={(morningWindowMinutes) => save({ morningWindowMinutes })}
        />
        <span style={{ fontSize: 14 }}>before</span>
      </Row>

      <Row
        label="TV unlocks again at"
        hint={
          s.lockEnds > '12:00'
            ? 'Evening: the bath/bed lock lifts at this time (grown-ups\' TV).'
            : 'Morning: the bath/bed lock holds overnight until this time.'
        }
      >
        <input
          type="time"
          aria-label="TV unlocks at"
          defaultValue={s.lockEnds}
          key={s.lockEnds}
          onBlur={(e) => {
            const v = e.target.value;
            if (v && v !== s.lockEnds) save({ lockEnds: v });
          }}
          style={{ ...fieldStyle, width: 120 }}
        />
      </Row>

      {error && (
        <p role="alert" style={{ fontSize: 13, color: 'var(--stale)', marginTop: 8 }}>
          {error}
        </p>
      )}
    </div>
  );
}
