import { Mic } from 'lucide-react';
import type { ParsedIntent } from '../../core/model/types';

interface Props {
  intent: ParsedIntent;
  transcript: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function describe(intent: ParsedIntent): string {
  switch (intent.intent) {
    case 'dinner_set':
      return `${intent.date} dinner: ${intent.meal}`;
    case 'chore_complete':
      return `${intent.person} — ${intent.chore}`;
    case 'query_dinner':
      return `What's for dinner ${intent.date}?`;
    case 'query_agenda':
      return `What's on ${intent.date}?`;
    case 'timer_set':
      return `Set ${intent.label ?? 'a'} timer for ${intent.duration_sec}s`;
    case 'timer_extend':
      return `Add ${intent.duration_sec}s to ${intent.label ?? 'the'} timer`;
    case 'timer_cancel':
      return `Cancel ${intent.label ?? 'the'} timer`;
    case 'timer_query':
      return `How long on ${intent.label ?? 'the'} timer?`;
    // Kid intents auto-apply at matcher 1.0 / Haiku ≥0.85 + threshold map,
    // so these describe() paths are typechecker-only. Spec §8.
    case 'ask_question': return `Answer your question`;
    case 'noise_play': return `Play a noise`;
    case 'joke_tell': return `Tell a joke`;
    case 'unknown':
      return `(didn't parse: ${intent.reason})`;
  }
}

export function ConfirmCard({ intent, transcript, onConfirm, onCancel }: Props) {
  return (
    <div
      role="dialog"
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.4)',
        zIndex: 100,
      }}
    >
      <div
        style={{
          background: 'var(--surface)',
          color: 'var(--text)',
          padding: 24,
          borderRadius: 'var(--r-lg)',
          minWidth: 560,
          boxShadow: 'var(--shadow)',
          border: '1px solid var(--border)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 22, fontWeight: 600 }}>
          <Mic size={22} color="var(--accent)" />
          <span>{describe(intent)}</span>
        </div>
        <div style={{ marginTop: 8, fontSize: 14, color: 'var(--text-muted)' }}>
          Heard: "{transcript}" · {Math.round(intent.confidence * 100)}%
        </div>
        <div style={{ marginTop: 16, display: 'flex', gap: 12 }}>
          <button
            onClick={onConfirm}
            style={{
              flex: 1,
              minHeight: 52,
              fontSize: 17,
              fontWeight: 600,
              background: 'var(--accent)',
              color: 'white',
              border: 0,
              borderRadius: 'var(--r-md)',
              cursor: 'pointer',
            }}
          >
            Say "yes" or tap Confirm
          </button>
          <button
            onClick={onCancel}
            style={{
              minHeight: 52,
              padding: '0 24px',
              fontSize: 17,
              background: 'var(--surface-2)',
              color: 'var(--text)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-md)',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
