import { useState } from 'react';
import { Power } from 'lucide-react';
import { api, ApiError } from '../../core/api/client';
import { Button } from '../primitives/Button';

export function KioskShutdown() {
  const [confirming, setConfirming] = useState(false);
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState('');

  const handleShutdown = async () => {
    setStatus('sending');
    try {
      await api.shutdownKiosk();
      setStatus('sent');
      setConfirming(false);
    } catch (err) {
      setStatus('error');
      setError(err instanceof ApiError ? err.message : 'Could not reach kiosk');
      setConfirming(false);
    }
  };

  if (status === 'sent') {
    return (
      <section style={{ marginTop: 32, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
        <p className="text-text-muted" style={{ fontSize: 14, textAlign: 'center' }}>
          Shutdown signal sent. The display will power off shortly.
        </p>
      </section>
    );
  }

  return (
    <section style={{ marginTop: 32, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
      {!confirming ? (
        <button
          type="button"
          onClick={() => { setConfirming(true); setStatus('idle'); setError(''); }}
          className="flex items-center gap-2 text-text-muted"
          style={{ fontSize: 14, padding: '8px 0' }}
        >
          <Power size={16} /> Shutdown display
        </button>
      ) : (
        <div className="flex items-center gap-3">
          <span className="text-text" style={{ fontSize: 14 }}>Shut down the wall display?</span>
          <Button variant="danger" onClick={handleShutdown} disabled={status === 'sending'}>
            {status === 'sending' ? 'Sending…' : 'Shut down'}
          </Button>
          <Button variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button>
        </div>
      )}
      {status === 'error' && (
        <p style={{ fontSize: 13, color: 'var(--stale)', marginTop: 8 }}>{error}</p>
      )}
    </section>
  );
}
