import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import { broker, type PokeKind } from '../realtime';
import { parseBody } from './helpers';

/** Minimum repo surface for the standard 4-handler CRUD shape. */
export interface CrudRepo<TList, TItem, TCreate, TUpdate> {
  list: () => TList;
  create: (body: TCreate) => TItem;
  update: (id: string, body: TUpdate) => TItem;
  remove: (id: string) => void;
}

/** Register the 4 standard CRUD handlers (list/create/update/remove) on `app`.
 *
 *  - GET    `${prefix}`         -> 200 + list
 *  - POST   `${prefix}`         -> 201 + item, pokes channel
 *  - PUT    `${prefix}/:id`     -> 200 + item, pokes channel
 *  - DELETE `${prefix}/:id`     -> 204,        pokes channel
 *
 *  Repo errors (404, 409, etc.) propagate to Fastify's error handler, so the
 *  helper is safe to use for routes whose `remove` may throw on conflict
 *  (e.g. categories' `ON DELETE RESTRICT` -> 409 CATEGORY_IN_USE).
 *
 *  Sub-resources (`GET /:id`, `/complete`, etc.) stay bespoke per route. */
export function registerCrud<
  TList,
  TItem,
  TCreateSchema extends z.ZodTypeAny,
  TUpdateSchema extends z.ZodTypeAny,
>(
  app: FastifyInstance,
  opts: {
    prefix: string;
    channel: PokeKind;
    create: TCreateSchema;
    update: TUpdateSchema;
    repo: CrudRepo<TList, TItem, z.output<TCreateSchema>, z.output<TUpdateSchema>>;
  },
): void {
  app.get(opts.prefix, async () => opts.repo.list());

  app.post(opts.prefix, async (req, reply) => {
    const item = opts.repo.create(parseBody(opts.create, req.body));
    broker.poke(opts.channel);
    reply.status(201);
    return item;
  });

  app.put<{ Params: { id: string } }>(`${opts.prefix}/:id`, async (req) => {
    const item = opts.repo.update(req.params.id, parseBody(opts.update, req.body));
    broker.poke(opts.channel);
    return item;
  });

  app.delete<{ Params: { id: string } }>(`${opts.prefix}/:id`, async (req, reply) => {
    opts.repo.remove(req.params.id);
    broker.poke(opts.channel);
    reply.status(204);
  });
}
