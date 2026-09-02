import { useEffect } from 'react';
import type { OverlayState, OverlayAction } from './voiceState';
import { autoFadeMs } from './voiceState';
import { ConfirmCard } from './ConfirmCard';

interface Props {
  state: OverlayState;
  dispatch: (a: OverlayAction) => void;
  onActiveChange?: (active: boolean) => void;
}

/**
 * Modal overlay piece of the voice UI: shows the `ConfirmCard` when a
 * mid-confidence intent needs a yes/no, and runs the auto-fade timer for
 * `applied`. The persistent status pill (icon + label + mute control) lives
 * in `VoiceChip` inside the ControlBar, NOT here.
 */
export function VoiceOverlay({ state, dispatch, onActiveChange }: Props) {
  useEffect(() => {
    onActiveChange?.(state.kind !== 'idle');
  }, [state.kind, onActiveChange]);

  // Per-utterance fade timer. utteranceId is in the dep array so a new
  // utterance arriving while we're still showing a terminal state resets the
  // timer (otherwise the second action would inherit the first's clock).
  const utteranceId = 'utterance_id' in state ? state.utterance_id : '';

  useEffect(() => {
    const ms = autoFadeMs(state.kind);
    if (ms === null) return;
    const t = setTimeout(() => dispatch({ type: 'auto-fade' }), ms);
    return () => clearTimeout(t);
  }, [state.kind, dispatch, utteranceId]);

  if (state.kind !== 'confirming') return null;
  return (
    <ConfirmCard
      intent={state.intent}
      transcript={state.transcript}
      onConfirm={() => dispatch({ type: 'auto-fade' })}
      onCancel={() => dispatch({ type: 'cancel' })}
    />
  );
}
