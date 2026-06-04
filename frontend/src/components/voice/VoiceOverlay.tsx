import { useEffect } from 'react';
import { useVoiceStatus } from '../../core/hooks/useData';
import type { OverlayState, OverlayAction } from './voiceState';
import { EarGlyph } from './EarGlyph';
import { ConfirmCard } from './ConfirmCard';

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

  const utteranceId = 'utterance_id' in state ? state.utterance_id : '';

  // Auto-fade `applied` after 2s
  useEffect(() => {
    if (state.kind !== 'applied') return;
    const t = setTimeout(() => dispatch({ type: 'auto-fade' }), 2000);
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
