import { Droplets } from 'lucide-react';
import type { WeatherData } from '../../core/model/types';
import { getWeatherIcon } from './weatherIcons';

interface Props {
  weather: WeatherData | undefined;
  isNight: boolean;
}

export function WeatherSidebar({ weather, isNight }: Props) {
  if (!weather) return null;

  const Icon = getWeatherIcon(weather.condition, isNight);
  const staleMs = Date.now() - new Date(weather.fetchedAt).getTime();
  const opacity = weather.stale || staleMs > 30 * 60_000 ? 0.6 : 1;

  return (
    <div className="flex items-center gap-3 text-right" style={{ opacity }}>
      <div className="flex flex-col items-end">
        <div className="flex items-center gap-2">
          <Icon size={28} style={{ color: 'var(--text-muted)' }} />
          <span className="font-mono font-bold leading-none tabular-nums" style={{ fontSize: 32 }}>
            {weather.temperature ?? '--'}°
          </span>
        </div>
        <div className="flex items-center gap-3 mt-1" style={{ fontSize: 15, color: 'var(--text-muted)' }}>
          <span>Feels {weather.feelsLike ?? '--'}°</span>
          {weather.humidity != null && (
            <span className="inline-flex items-center gap-1">
              <Droplets size={14} />
              {weather.humidity}%
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
