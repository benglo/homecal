import { Component, type ReactNode } from 'react';
import { Clock } from './Clock';
import { useClock } from '../../core/hooks/useClock';

interface Props {
  children: ReactNode;
}
interface State {
  failed: boolean;
}

/** Functional fallback so the clock keeps ticking even while the app tree is down. */
function ReconnectingScreen() {
  const now = useClock();
  return (
    <div className="h-full grid place-items-center" style={{ background: 'var(--bg)', color: 'var(--text)' }}>
      <div className="flex flex-col items-center" style={{ gap: 12 }}>
        <Clock now={now} />
        <span className="text-text-muted" style={{ fontSize: 18 }}>
          Reconnecting…
        </span>
      </div>
    </div>
  );
}

/** Top-level never-blank guard. A render-time throw on the always-on wall must NEVER
 *  white-screen or show a stack trace — we fall back to the live clock + a calm
 *  "Reconnecting…" line on the themed background. The ticking clock proves the screen
 *  is alive while React's automatic remounts (and the SSE/poll refetch) recover. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(): void {
    // Auto-retry shortly: most throws here are transient (a bad payload that the next
    // refetch corrects). Clearing the flag re-renders the real tree.
    setTimeout(() => this.setState({ failed: false }), 4000);
  }

  render(): ReactNode {
    return this.state.failed ? <ReconnectingScreen /> : this.props.children;
  }
}
