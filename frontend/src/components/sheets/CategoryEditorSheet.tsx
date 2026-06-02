import { useState } from 'react';
import type { Category } from '../../core/model/types';
import { useCategoryMutations } from '../../core/hooks/useMutations';
import { ApiError } from '../../core/api/client';
import { chipFill, contrastRatio, fgForBg, isHex6 } from '../../core/util/color';
import { iconFor } from '../../core/util/icons';
import { Sheet } from './Sheet';
import { Button } from '../primitives/Button';
import { Field, FormError, TextInput } from './fields';
import { TogglePill } from '../ui/TogglePill';

interface Props {
  open: boolean;
  onClose: () => void;
  category?: Category | null; // present → edit
}

/** Okabe–Ito colourblind-safe palette (matches the seed defaults). */
const PRESETS = ['#0072b2', '#009e73', '#e69f00', '#d55e00', '#cc79a7', '#56b4e9', '#f0e442', '#999999'];
const ICONS = ['clipboard-check', 'sparkles', 'backpack', 'activity', 'utensils', 'circle'];

const DAY_SURFACE = '#ffffff';
const NIGHT_SURFACE = '#1c1917';

export function CategoryEditorSheet({ open, onClose, category }: Props) {
  const editing = !!category;
  const { create, update } = useCategoryMutations();
  const [name, setName] = useState(category?.name ?? '');
  const [color, setColor] = useState(category?.color ?? PRESETS[0]);
  const [icon, setIcon] = useState(category?.icon ?? 'circle');
  const [error, setError] = useState('');

  if (!open) return null;

  // Graphical-object AA is 3:1. Warn if the colour reads poorly on *both* themes.
  const cDay = contrastRatio(color, DAY_SURFACE);
  const cNight = contrastRatio(color, NIGHT_SURFACE);
  const lowContrast = isHex6(color) && cDay != null && cNight != null && cDay < 3 && cNight < 3;

  const save = () => {
    if (!name.trim()) {
      setError('Give the category a name.');
      return;
    }
    if (!isHex6(color)) {
      setError('Colour must be a #RRGGBB hex value.');
      return;
    }
    const body = { name: name.trim(), color, icon };
    const onError = (err: unknown) =>
      setError(err instanceof ApiError ? err.message : 'Could not save — try again.');
    if (editing && category) update.mutate({ id: category.id, body }, { onSuccess: onClose, onError });
    else create.mutate(body, { onSuccess: onClose, onError });
  };

  const Icon = iconFor(icon);
  const actions = (
    <>
      <Button variant="ghost" onClick={onClose}>
        Cancel
      </Button>
      <Button variant="primary" onClick={save} disabled={create.isPending || update.isPending}>
        {editing ? 'Save' : 'Add category'}
      </Button>
    </>
  );

  return (
    <Sheet open onClose={onClose} title={editing ? 'Edit category' : 'New category'} actions={actions}>
      <FormError>{error}</FormError>

      {/* Live preview chip */}
      <div className="flex items-center gap-2" style={{ marginBottom: 18 }}>
        <span
          className="inline-flex items-center gap-2 font-semibold rounded-md border"
          style={{
            padding: '8px 14px',
            fontSize: 16,
            background: chipFill(color, 0.15),
            color: fgForBg(color) === '#000000' ? 'var(--text)' : color,
            borderColor: chipFill(color, 0.35),
          }}
        >
          <Icon size={16} strokeWidth={2} style={{ color }} />
          {name.trim() || 'Preview'}
        </span>
      </div>

      <Field label="Name">
        <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Swimming" autoFocus maxLength={64} />
      </Field>

      <Field label="Colour" hint={lowContrast ? '⚠ Low contrast on both light and dark — pick a bolder colour.' : undefined}>
        <div className="flex flex-wrap items-center gap-2" style={{ marginBottom: 10 }}>
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setColor(p)}
              aria-label={p}
              className="rounded-full"
              style={{
                width: 36,
                height: 36,
                background: p,
                outline: color.toLowerCase() === p ? '3px solid var(--accent)' : '1px solid var(--border)',
                outlineOffset: 2,
              }}
            />
          ))}
        </div>
        <TextInput value={color} onChange={(e) => setColor(e.target.value)} placeholder="#RRGGBB" style={{ fontFamily: 'var(--font-mono, monospace)' }} />
      </Field>

      <Field label="Icon">
        <div className="flex flex-wrap gap-2">
          {ICONS.map((key) => {
            const Ic = iconFor(key);
            return (
              <TogglePill
                key={key}
                active={key === icon}
                onClick={() => setIcon(key)}
                ariaLabel={key}
                style={{
                  width: 46,
                  height: 46,
                  minHeight: 46,
                  padding: 0,
                  display: 'grid',
                  placeItems: 'center',
                }}
              >
                <Ic size={20} strokeWidth={2} />
              </TogglePill>
            );
          })}
        </div>
      </Field>
    </Sheet>
  );
}
