import type { LucideIcon } from 'lucide-react';
import {
  Sun, Moon, Cloud, CloudMoon, CloudRain, CloudDrizzle,
  CloudLightning, CloudSnow, CloudFog, Wind,
} from 'lucide-react';

const DAY_ICONS: Record<string, LucideIcon> = {
  Clear: Sun,
  Clouds: Cloud,
  Rain: CloudRain,
  Drizzle: CloudDrizzle,
  Thunderstorm: CloudLightning,
  Snow: CloudSnow,
  Fog: CloudFog,
  Wind: Wind,
};

const NIGHT_OVERRIDES: Record<string, LucideIcon> = {
  Clear: Moon,
  Clouds: CloudMoon,
};

export function getWeatherIcon(condition: string, isNight: boolean): LucideIcon {
  if (isNight && NIGHT_OVERRIDES[condition]) return NIGHT_OVERRIDES[condition];
  return DAY_ICONS[condition] ?? Sun;
}
