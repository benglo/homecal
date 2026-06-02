export interface WeatherData {
  temperature: number | null;
  feelsLike: number | null;
  condition: string;
  description: string;
  humidity: number | null;
  windSpeed: number | null;
  windDirection: string;
  pressure: number | null;
  stationName: string;
  observationTime: string | null;
  fetchedAt: string;
  stale?: boolean;
}

interface CacheEntry {
  data: WeatherData;
  ts: number;
}

const BOM_BASE = 'http://www.bom.gov.au/fwo';
let cache: CacheEntry | null = null;
let hasLoggedFirstSuccess = false;
let lastFetchFailed = false;

export function safeParseFloat(value: unknown): number | null {
  if (value === null || value === undefined || value === '-') return null;
  const n = parseFloat(String(value));
  return Number.isNaN(n) ? null : Math.round(n);
}

export function mapBomCondition(raw: string | null | undefined): string {
  if (!raw) return 'Clear';
  const w = raw.toLowerCase();
  if (w.includes('rain') || w.includes('shower')) return 'Rain';
  if (w.includes('storm') || w.includes('thunder')) return 'Thunderstorm';
  if (w.includes('cloud') || w.includes('overcast')) return 'Clouds';
  if (w.includes('fog') || w.includes('mist')) return 'Fog';
  if (w.includes('drizzle')) return 'Drizzle';
  if (w.includes('wind')) return 'Wind';
  if (w.includes('snow')) return 'Snow';
  if (w.includes('clear') || w.includes('sunny') || w.includes('fine')) return 'Clear';
  return 'Clear';
}

export async function fetchBomWeather(
  stationCode: string,
  stationId: string,
  logger?: { info: (msg: string) => void; warn: (msg: string) => void },
): Promise<WeatherData> {
  const url = `${BOM_BASE}/${stationCode}/${stationCode}.${stationId}.json`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    headers: { 'User-Agent': 'HomeCal/1.0' },
  });
  if (!res.ok) throw new Error(`BOM returned ${res.status}`);

  const body = await res.json();
  const observations = body?.observations?.data;
  if (!Array.isArray(observations) || observations.length === 0) {
    throw new Error('Unexpected BOM response structure');
  }
  const latest = observations[0];

  if (!hasLoggedFirstSuccess) {
    hasLoggedFirstSuccess = true;
    logger?.info(`Weather: first BOM fetch OK from ${url}`);
  }
  if (lastFetchFailed) {
    lastFetchFailed = false;
    logger?.info('Weather: BOM fetch recovered');
  }

  return {
    temperature: safeParseFloat(latest.air_temp),
    feelsLike: safeParseFloat(latest.apparent_t) ?? safeParseFloat(latest.air_temp),
    condition: mapBomCondition(latest.weather),
    description: latest.weather || 'Clear',
    humidity: safeParseFloat(latest.rel_hum),
    windSpeed: safeParseFloat(latest.wind_spd_kmh),
    windDirection: latest.wind_dir || '',
    pressure: safeParseFloat(latest.press_msl),
    stationName: latest.name || '',
    observationTime: latest.aifstime_utc || null,
    fetchedAt: new Date().toISOString(),
  };
}

export async function getCachedWeather(
  stationCode: string,
  stationId: string,
  ttlMs: number,
  logger?: { info: (msg: string) => void; warn: (msg: string) => void },
): Promise<WeatherData> {
  if (cache && Date.now() - cache.ts < ttlMs) {
    return cache.data;
  }

  try {
    const data = await fetchBomWeather(stationCode, stationId, logger);
    cache = { data, ts: Date.now() };
    return data;
  } catch (err) {
    if (!lastFetchFailed) {
      lastFetchFailed = true;
      logger?.warn(`Weather: BOM fetch failed — ${(err as Error).message}`);
    }
    if (cache) {
      return { ...cache.data, stale: true };
    }
    throw err;
  }
}

export function _resetCacheForTest(): void {
  cache = null;
  hasLoggedFirstSuccess = false;
  lastFetchFailed = false;
}
