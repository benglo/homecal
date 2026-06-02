import type { FastifyInstance } from 'fastify';
import { config } from '../config';
import { getCachedWeather } from '../weather';
import { httpError } from '../util/errors';

export async function weatherRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/weather', async (_req, reply) => {
    try {
      const data = await getCachedWeather(
        config.bomStationCode,
        config.bomStationId,
        config.weatherCacheTtlMs,
        app.log,
      );
      return reply.send(data);
    } catch {
      throw httpError(503, 'WEATHER_UNAVAILABLE', 'Weather data is temporarily unavailable');
    }
  });
}
