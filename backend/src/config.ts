import path from 'node:path';

/**
 * Central runtime config. Everything is overridable by env so the same image
 * runs in dev (local data dir) and in the container (host-mounted /data).
 */
export const config = {
  port: Number(process.env.PORT ?? 8787),
  host: process.env.HOST ?? '0.0.0.0', // bind all interfaces inside the container

  // SQLite lives in a DIRECTORY (so .db + -wal + -shm all persist together).
  // In the container this is the host bind-mount; in dev it defaults to ./data.
  dataDir: process.env.DATA_DIR ?? path.resolve(process.cwd(), 'data'),
  dbFileName: process.env.DB_FILENAME ?? 'calendar.db',

  // Path to the built frontend (set in the Docker runtime stage).
  // Empty string disables static serving (e.g. when running API standalone in dev).
  staticDir: process.env.STATIC_DIR ?? '',

  // Photo storage — flat directory of UUIDv7-named JPEGs inside dataDir.
  photosDir: path.join(process.env.DATA_DIR ?? path.resolve(process.cwd(), 'data'), 'photos'),
  maxPhotoCount: Number(process.env.MAX_PHOTO_COUNT ?? 500),

  // Kiosk Pi — set to enable remote shutdown from the phone app.
  // The Pi runs a tiny HTTP listener (kiosk/shutdown-service.sh) on this port.
  kioskHost: process.env.KIOSK_HOST ?? '',
  kioskPort: Number(process.env.KIOSK_PORT ?? 8788),

  // BOM weather station — defaults to Brisbane.
  bomStationCode: process.env.BOM_STATION_CODE ?? 'IDQ60901',
  bomStationId: process.env.BOM_STATION_ID ?? '94576',
  bomStationName: process.env.BOM_STATION_NAME ?? 'Brisbane',
  weatherCacheTtlMs: Number(process.env.WEATHER_CACHE_TTL_MS ?? 900_000),

  timezone: 'Australia/Brisbane',
} as const;

export const dbPath = path.join(config.dataDir, config.dbFileName);
