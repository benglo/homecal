import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { config } from '../config';
import { listPhotos, savePhoto, softDelete, photoPath, FILENAME_RE } from '../photos';
import { httpError } from '../util/errors';
import { broker } from '../realtime';

export async function photoRoutes(app: FastifyInstance): Promise<void> {
  await app.register(multipart, {
    limits: { fileSize: 20 * 1024 * 1024 },
  });

  app.get('/api/photos', async () => {
    return { data: listPhotos(config.photosDir) };
  });

  app.post('/api/photos', async (req, reply) => {
    const file = await req.file();
    if (!file) throw httpError(400, 'NO_FILE', 'No file uploaded');

    const buffer = await file.toBuffer();
    const photo = await savePhoto(config.photosDir, buffer, config.maxPhotoCount);
    broker.poke('photos');
    return reply.status(201).send(photo);
  });

  app.delete<{ Params: { id: string } }>('/api/photos/:id', async (req, reply) => {
    softDelete(config.photosDir, req.params.id);
    broker.poke('photos');
    return reply.status(204).send();
  });

  app.get<{ Params: { filename: string } }>('/api/photos/:filename', async (req, reply) => {
    const { filename } = req.params;
    if (!FILENAME_RE.test(filename)) throw httpError(400, 'INVALID_FILENAME', 'Invalid photo filename');

    const id = filename.replace('.jpg', '');
    const resolved = photoPath(config.photosDir, id);
    if (!fs.existsSync(resolved)) throw httpError(404, 'NOT_FOUND', 'Photo not found');

    return reply
      .header('content-type', 'image/jpeg')
      .header('x-content-type-options', 'nosniff')
      .header('cache-control', 'public, max-age=31536000, immutable')
      .send(fs.createReadStream(resolved));
  });
}
