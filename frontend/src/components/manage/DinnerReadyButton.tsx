import { useEffect, useState } from 'react';
import { UtensilsCrossed } from 'lucide-react';
import { useCallDinner } from '../../core/hooks/useMutations';
import { Button } from '../primitives/Button';

/** One tap tells every screen (TV, wall) that dinner is on the table.
 *  Shows a short confirmation so a double-tap doesn't feel lost. */
export function DinnerReadyButton() {
  const call = useCallDinner();
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (!sent) return;
    const t = setTimeout(() => setSent(false), 4000);
    return () => clearTimeout(t);
  }, [sent]);

  return (
    <section style={{ marginBottom: 24 }}>
      <Button
        variant="primary"
        disabled={call.isPending}
        onClick={() => call.mutate(undefined, { onSuccess: () => setSent(true) })}
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}
      >
        <UtensilsCrossed size={20} aria-hidden />
        {sent ? 'Sent to the TV' : call.isPending ? 'Sending…' : "Dinner's ready"}
      </Button>
      {call.isError && (
        <p role="alert" style={{ fontSize: 13, color: 'var(--stale)', marginTop: 6 }}>
          Couldn't send. Try again.
        </p>
      )}
    </section>
  );
}
