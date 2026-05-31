import type { ReactNode } from 'react';
import type { Category } from '../../core/model/types';
import { chipFill, fgForBg } from '../../core/util/color';
import { iconFor } from '../../core/util/icons';

/** Labelled form row used across the editor sheets. */
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block" style={{ marginBottom: 18 }}>
      <span className="block font-medium text-text-muted" style={{ fontSize: 13, marginBottom: 7, textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {label}
      </span>
      {children}
      {hint && (
        <span className="block text-text-faint" style={{ fontSize: 12, marginTop: 5 }}>
          {hint}
        </span>
      )}
    </label>
  );
}

const INPUT_STYLE: React.CSSProperties = {
  width: '100%',
  minHeight: 46,
  padding: '11px 13px',
  fontSize: 16,
  borderRadius: 'var(--r-sm)',
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--text)',
};

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} style={{ ...INPUT_STYLE, ...props.style }} />;
}

/** Horizontal scroll of colour-chip category options (big touch targets). */
export function CategoryPicker({
  categories,
  value,
  onChange,
}: {
  categories: Category[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {categories.map((c) => {
        const active = c.id === value;
        const Icon = iconFor(c.icon);
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => onChange(c.id)}
            aria-pressed={active}
            className="inline-flex items-center gap-2 font-semibold rounded-md border"
            style={{
              minHeight: 44,
              padding: '9px 14px',
              fontSize: 15,
              background: active ? chipFill(c.color, 0.22) : 'var(--surface)',
              color: fgForBg(c.color) === '#000000' ? 'var(--text)' : c.color,
              borderColor: active ? c.color : 'var(--border)',
              borderWidth: active ? 2 : 1,
            }}
          >
            <Icon size={16} strokeWidth={2} style={{ color: c.color }} />
            {c.name}
          </button>
        );
      })}
    </div>
  );
}

/** Inline error / info message shown inside a sheet (user errors only). */
export function FormError({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p
      className="rounded-md"
      style={{ background: chipFill('#d97706', 0.14), color: 'var(--stale)', padding: '10px 12px', fontSize: 14, marginBottom: 14 }}
      role="alert"
    >
      {children}
    </p>
  );
}
