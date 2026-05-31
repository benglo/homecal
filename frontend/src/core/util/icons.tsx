import {
  Activity,
  Backpack,
  ClipboardCheck,
  Circle,
  Sparkles,
  Utensils,
  type LucideIcon,
} from 'lucide-react';

/** Category icon-key → lucide component. Falls back to Circle. */
const REGISTRY: Record<string, LucideIcon> = {
  'clipboard-check': ClipboardCheck,
  sparkles: Sparkles,
  backpack: Backpack,
  activity: Activity,
  utensils: Utensils,
  circle: Circle,
};

export function iconFor(key: string | null | undefined): LucideIcon {
  return (key && REGISTRY[key]) || Circle;
}
