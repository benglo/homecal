import { CalendarDays, CalendarRange, Settings2, type LucideIcon } from 'lucide-react';

export type PhoneTab = 'agenda' | 'week' | 'manage';

const TABS: { key: PhoneTab; label: string; Icon: LucideIcon }[] = [
  { key: 'agenda', label: 'Agenda', Icon: CalendarDays },
  { key: 'week', label: 'Week', Icon: CalendarRange },
  { key: 'manage', label: 'Manage', Icon: Settings2 },
];

interface Props {
  value: PhoneTab;
  onChange: (tab: PhoneTab) => void;
}

/** Bottom phone navigation (thumb zone), ≥48px targets. */
export function TabBar({ value, onChange }: Props) {
  return (
    <nav
      role="tablist"
      className="flex shrink-0 border-t border-border bg-surface"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      {TABS.map(({ key, label, Icon }) => {
        const active = key === value;
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(key)}
            className="flex-1 flex flex-col items-center justify-center gap-1"
            style={{ minHeight: 56, color: active ? 'var(--accent)' : 'var(--text-muted)' }}
          >
            <Icon size={22} strokeWidth={active ? 2.4 : 2} />
            <span style={{ fontSize: 11, fontWeight: active ? 600 : 500 }}>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
