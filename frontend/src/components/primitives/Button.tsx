import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'ghost' | 'danger';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  children: ReactNode;
}

const BASE = 'rounded-md font-semibold transition-colors disabled:opacity-50';

/** Token-driven button. ≥44px tall so it clears touch targets on phone + sheet footers. */
export function Button({ variant = 'ghost', children, style, ...rest }: Props) {
  const variantStyle: Record<Variant, React.CSSProperties> = {
    primary: { background: 'var(--accent)', color: '#fff' },
    ghost: { background: 'var(--surface-2)', color: 'var(--text)' },
    danger: { background: 'transparent', color: 'var(--stale)' },
  };
  return (
    <button
      type="button"
      className={BASE}
      style={{ minHeight: 52, padding: '14px 24px', fontSize: 17, ...variantStyle[variant], ...style }}
      {...rest}
    >
      {children}
    </button>
  );
}
