import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mapBomCondition, safeParseFloat, fetchBomWeather, getCachedWeather, _resetCacheForTest } from '../weather';

describe('safeParseFloat', () => {
  it('parses a number', () => assert.equal(safeParseFloat(23.7), 24));
  it('parses a string number', () => assert.equal(safeParseFloat('18.2'), 18));
  it('returns null for null', () => assert.equal(safeParseFloat(null), null));
  it('returns null for undefined', () => assert.equal(safeParseFloat(undefined), null));
  it('returns null for dash', () => assert.equal(safeParseFloat('-'), null));
  it('returns null for NaN string', () => assert.equal(safeParseFloat('abc'), null));
});

describe('mapBomCondition', () => {
  it('maps rain', () => assert.equal(mapBomCondition('Light Rain'), 'Rain'));
  it('maps shower', () => assert.equal(mapBomCondition('Showers'), 'Rain'));
  it('maps thunderstorm', () => assert.equal(mapBomCondition('Thunderstorms'), 'Thunderstorm'));
  it('maps cloudy', () => assert.equal(mapBomCondition('Partly Cloudy'), 'Clouds'));
  it('maps overcast', () => assert.equal(mapBomCondition('Overcast'), 'Clouds'));
  it('maps fog', () => assert.equal(mapBomCondition('Fog'), 'Fog'));
  it('maps mist', () => assert.equal(mapBomCondition('Mist'), 'Fog'));
  it('maps drizzle', () => assert.equal(mapBomCondition('Drizzle'), 'Drizzle'));
  it('maps wind', () => assert.equal(mapBomCondition('Windy'), 'Wind'));
  it('maps snow', () => assert.equal(mapBomCondition('Snow'), 'Snow'));
  it('maps clear', () => assert.equal(mapBomCondition('Clear'), 'Clear'));
  it('maps sunny', () => assert.equal(mapBomCondition('Sunny'), 'Clear'));
  it('maps fine', () => assert.equal(mapBomCondition('Fine'), 'Clear'));
  it('defaults null to Clear', () => assert.equal(mapBomCondition(null), 'Clear'));
  it('defaults unknown to Clear', () => assert.equal(mapBomCondition('Haze'), 'Clear'));
});

const BOM_FIXTURE = {
  observations: {
    data: [
      {
        air_temp: 22.3,
        apparent_t: 19.8,
        weather: 'Partly Cloudy',
        rel_hum: 65,
        wind_spd_kmh: 12,
        wind_dir: 'SSE',
        press_msl: 1018.5,
        name: 'Brisbane',
        aifstime_utc: '20260602030000',
      },
    ],
  },
};

describe('fetchBomWeather', () => {
  let originalFetch: typeof globalThis.fetch;

  before(() => { originalFetch = globalThis.fetch; });
  after(() => { globalThis.fetch = originalFetch; });

  it('parses a valid BOM response', async () => {
    globalThis.fetch = mock.fn(async () => new Response(JSON.stringify(BOM_FIXTURE), { status: 200 })) as typeof fetch;
    const data = await fetchBomWeather('IDQ60901', '94576');
    assert.equal(data.temperature, 22);
    assert.equal(data.feelsLike, 20);
    assert.equal(data.condition, 'Clouds');
    assert.equal(data.description, 'Partly Cloudy');
    assert.equal(data.humidity, 65);
    assert.equal(data.windSpeed, 12);
    assert.equal(data.windDirection, 'SSE');
    assert.equal(data.stationName, 'Brisbane');
    assert.ok(data.fetchedAt);
  });

  it('throws on non-200 response', async () => {
    globalThis.fetch = mock.fn(async () => new Response('', { status: 500 })) as typeof fetch;
    await assert.rejects(() => fetchBomWeather('IDQ60901', '94576'), /BOM returned 500/);
  });

  it('throws on unexpected structure', async () => {
    globalThis.fetch = mock.fn(async () => new Response(JSON.stringify({ foo: 'bar' }), { status: 200 })) as typeof fetch;
    await assert.rejects(() => fetchBomWeather('IDQ60901', '94576'), /Unexpected BOM response/);
  });

  it('throws on empty observations', async () => {
    const empty = { observations: { data: [] } };
    globalThis.fetch = mock.fn(async () => new Response(JSON.stringify(empty), { status: 200 })) as typeof fetch;
    await assert.rejects(() => fetchBomWeather('IDQ60901', '94576'), /Unexpected BOM response/);
  });
});

describe('getCachedWeather', () => {
  let originalFetch: typeof globalThis.fetch;

  before(() => { originalFetch = globalThis.fetch; });
  after(() => { globalThis.fetch = originalFetch; });

  it('caches and returns cached data within TTL', async () => {
    _resetCacheForTest();
    let callCount = 0;
    globalThis.fetch = mock.fn(async () => {
      callCount++;
      return new Response(JSON.stringify(BOM_FIXTURE), { status: 200 });
    }) as typeof fetch;

    const first = await getCachedWeather('IDQ60901', '94576', 60_000);
    const second = await getCachedWeather('IDQ60901', '94576', 60_000);
    assert.equal(callCount, 1);
    assert.equal(first.temperature, second.temperature);
  });

  it('returns stale data when fetch fails but cache exists', async () => {
    _resetCacheForTest();
    globalThis.fetch = mock.fn(async () => new Response(JSON.stringify(BOM_FIXTURE), { status: 200 })) as typeof fetch;
    await getCachedWeather('IDQ60901', '94576', 0); // populate cache, TTL=0 so immediately expired

    globalThis.fetch = mock.fn(async () => { throw new Error('network'); }) as typeof fetch;
    const stale = await getCachedWeather('IDQ60901', '94576', 0);
    assert.equal(stale.stale, true);
    assert.equal(stale.temperature, 22);
  });

  it('throws when fetch fails and no cache exists', async () => {
    _resetCacheForTest();
    globalThis.fetch = mock.fn(async () => { throw new Error('network'); }) as typeof fetch;
    await assert.rejects(() => getCachedWeather('IDQ60901', '94576', 60_000), /network/);
  });
});
