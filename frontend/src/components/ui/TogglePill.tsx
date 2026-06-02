import type { CSSProperties, ReactNode } from 'react';

type Variant = 'soft' | 'solid';

interface TogglePillProps {
  /** Whether this pill is the selected/active state. */
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  /** Accessible label, used when children are icons/non-text. */
  ariaLabel?: string;
  /** Visual style:
   *  - `soft` (default): `var(--accent-weak)` background + `var(--accent-ink)` text when active.
   *    Used everywhere except the EventEditor repeat-frequency picker.
   *  - `solid`: `var(--accent)` background + white text when active. */
  variant?: Variant;
  /** Style overrides for sizing (width, padding, fontSize, …). The active/inactive
   *  colours come from `variant` and are not overrideable. */
  style?: CSSProperties;
}

const ACTIVE_COLOURS: Record<Variant, { bg: string; fg: string; border: string }> = {
  soft: {
    bg: 'var(--accent-weak)',
    fg: 'var(--accent-ink)',
    border: 'var(--accent)',
  },
  solid: {
    bg: 'var(--accent)',
    fg: '#fff',
    border: 'var(--accent)',
  },
};

const INACTIVE = {
  bg: 'var(--surface)',
  fg: 'var(--text-muted)',
  border: 'var(--border)',
};

/** Pill-shaped toggle button used throughout the editor sheets and chore form
 *  (frequency, day-of-week, all-day, icon picker). Centralises the active/inactive
 *  colour treatment so we get consistent feedback across the app.
 *
 *  Sizing varies per site (min-height, padding) and is left to `style`. */
export function TogglePill({
  active,
  onClick,
  children,
  ariaLabel,
  variant = 'soft',
  style,
}: TogglePillProps) {
  const colours = active ? ACTIVE_COLOURS[variant] : INACTIVE;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={ariaLabel}
      className="rounded-md border font-medium"
      style={{
        minHeight: 44,
        padding: '8px 13px',
        fontSize: 14,
        background: colours.bg,
        color: colours.fg,
        borderColor: colours.border,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

export interface TogglePillOption<T> {
  value: T;
  label: ReactNode;
  /** Optional aria-label override per option (defaults to label if it's a string). */
  ariaLabel?: string;
}

interface TogglePillGroupProps<T> {
  options: ReadonlyArray<TogglePillOption<T>>;
  value: T | null;
  onChange: (next: T) => void;
  ariaLabel?: string;
  variant?: Variant;
  /** Per-pill style. */
  pillStyle?: CSSProperties;
  /** Container className (defaults to `flex flex-wrap gap-2`). */
  className?: string;
}

/** Row of TogglePills bound to a single value — used for radio-style pickers
 *  (frequency, day-of-week, all-day toggle). Single-value selection only.
 *
 *  For grid/non-row layouts (e.g. the icon picker), render individual `TogglePill`s. */
export function TogglePillGroup<T extends string | number>({
  options,
  value,
  onChange,
  ariaLabel,
  variant = 'soft',
  pillStyle,
  className = 'flex flex-wrap gap-2',
}: TogglePillGroupProps<T>) {
  return (
    <div className={className} role="group" aria-label={ariaLabel}>
      {options.map((opt) => (
        <TogglePill
          key={String(opt.value)}
          active={opt.value === value}
          onClick={() => onChange(opt.value)}
          ariaLabel={opt.ariaLabel}
          variant={variant}
          style={pillStyle}
        >
          {opt.label}
        </TogglePill>
      ))}
    </div>
  );
}
