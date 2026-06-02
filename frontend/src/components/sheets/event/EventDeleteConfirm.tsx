import { Button } from '../../primitives/Button';

interface Props {
  isRecurring: boolean;
  onDeleteThis: () => void;
  onDeleteSeries: () => void;
  onCancel: () => void;
}

/** "Delete this occurrence / Delete series" confirmation panel.
 *  For non-recurring events it collapses to a single Delete button. */
export function EventDeleteConfirm({ isRecurring, onDeleteThis, onDeleteSeries, onCancel }: Props) {
  return (
    <div className="rounded-md border border-border" style={{ padding: 14, marginTop: 4 }}>
      <p className="font-medium text-text" style={{ marginBottom: 12 }}>
        {isRecurring ? 'Delete which events?' : 'Delete this event?'}
      </p>
      <div className="flex flex-wrap gap-2">
        {isRecurring ? (
          <>
            <Button variant="danger" onClick={onDeleteThis} style={{ border: '1px solid var(--border)' }}>
              This event only
            </Button>
            <Button variant="danger" onClick={onDeleteSeries} style={{ border: '1px solid var(--border)' }}>
              Whole series
            </Button>
          </>
        ) : (
          <Button variant="danger" onClick={onDeleteSeries} style={{ border: '1px solid var(--border)' }}>
            Delete
          </Button>
        )}
        <Button variant="ghost" onClick={onCancel}>
          Keep
        </Button>
      </div>
    </div>
  );
}
