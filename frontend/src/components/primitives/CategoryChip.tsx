import type { Category } from '../../core/model/types';
import { chipFill, fgForBg } from '../../core/util/color';
import { iconFor } from '../../core/util/icons';

interface Props {
  category?: Category;
  size?: 'wall' | 'phone' | 'mini';
}

/** Colour + icon + label. Colour is NEVER the only signal (colourblind-safe). */
export function CategoryChip({ category, size = 'wall' }: Props) {
  const color = category?.color ?? 'var(--c-uncat)';
  const name = category?.name ?? 'Uncategorized';
  const Icon = iconFor(category?.icon);

  if (size === 'mini') {
    return (
      <span
        className="grid place-items-center rounded-md shrink-0"
        style={{ width: 26, height: 26, background: chipFill(color, 0.16), color }}
        title={name}
        aria-label={name}
      >
        <Icon size={14} strokeWidth={2.2} />
      </span>
    );
  }

  const wall = size === 'wall';
  return (
    <span
      className="inline-flex items-center gap-2 shrink-0 font-semibold rounded-md border"
      style={{
        padding: wall ? '8px 14px' : '5px 10px',
        fontSize: wall ? 18 : 13,
        background: chipFill(color, 0.15),
        color: fgForBg(color) === '#000000' ? 'var(--text)' : color,
        borderColor: chipFill(color, 0.35),
      }}
    >
      <Icon size={wall ? 18 : 14} strokeWidth={2} style={{ color }} />
      {name}
    </span>
  );
}
