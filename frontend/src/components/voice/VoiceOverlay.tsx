import { useEffect } from 'react';
import { useVoiceStatus } from '../../core/hooks/useData';
import type { OverlayState, OverlayAction } from './voiceState';
import { EarGlyph } from './EarGlyph';
import { ConfirmCard } from './ConfirmCard';

/** How long the `applied` state stays on screen before fading back to idle. */
const APPLIED_AUTO_FADE_MS = 2000;

interface Props {
  state: OverlayState;
  dispatch: (a: OverlayAction) => void;
  onActiveChange?: (active: boolean) => void;
}

export function VoiceOverlay({ state, dispatch, onActiveChange }: Props) {
  const { data: status } = useVoiceStatus();
  const muted = !!status?.muted;

  useEffect(() => {
    onActiveChange?.(state.kind !== 'idle');
  }, [state.kind, onActiveChange]);

  // Per-utterance fade timer. utteranceId is in the dep array so a new
  // utterance arriving while we're still showing `applied` resets the
  // timer (otherwise the second action would inherit the first's clock).
  const utteranceId = 'utterance_id' in state ? state.utterance_id : '';

  useEffect(() => {
    if (state.kind !== 'applied') return;
    const t = setTimeout(() => dispatch({ type: 'auto-fade' }), APPLIED_AUTO_FADE_MS);
    return () => clearTimeout(t);
  }, [state.kind, dispatch, utteranceId]);

  if (muted && state.kind === 'idle') {
    return <EarGlyph state={state} muted />;
  }

  return (
    <>
      <EarGlyph state={state} muted={muted} />
      {state.kind === 'confirming' && (
        <ConfirmCard
          intent={state.intent}
          transcript={state.transcript}
          onConfirm={() => dispatch({ type: 'auto-fade' })}
          onCancel={() => dispatch({ type: 'cancel' })}
        />
      )}
    </>
  );
}
