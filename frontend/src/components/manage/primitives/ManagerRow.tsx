import type { ReactNode } from 'react';

interface Props {
  /** Left-side icon tile (typically a 36×36 surface-2 square with an emoji or chip). */
  leading?: ReactNode;
  /** Primary row text. */
  title: ReactNode;
  /** Secondary line beneath the title (e.g. stars + frequency badge in ChoreManager). */
  subtitle?: ReactNode;
  /** Trailing action buttons (Edit, Delete, reorder, …). Rendered inline after the body. */
  actions?: ReactNode;
  /** Optional content rendered beneath the main row — used for inline confirm-delete
   *  prompts and error banners that share the row's container. */
  children?: ReactNode;
}

/** Rounded surface row used by every manage list (category, family member, chore).
 *  Provides the consistent leading-icon → title block → trailing actions layout
 *  and a slot for inline confirm/error UI underneath. */
export function ManagerRow({ leading, title, subtitle, actions, children }: Props) {
  return (
    <div
      className="rounded-md border border-border"
      style={{ background: 'var(--surface)' }}
    >
      <div className="flex items-center gap-3" style={{ padding: '10px 12px' }}>
        {leading}
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-text truncate" style={{ fontSize: 15 }}>
            {title}
          </div>
          {subtitle && (
            <div
              className="flex items-center gap-2 text-text-muted"
              style={{ fontSize: 12, marginTop: 2 }}
            >
              {subtitle}
            </div>
          )}
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
}
