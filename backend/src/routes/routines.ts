import type { FastifyInstance } from 'fastify';
import { routineCreate, routineUpdate, dayPlanQuery, routineSettingsUpdate } from '../schemas';
import { getRoutineSettings, updateRoutineSettings } from '../repos/routineSettings';
import { listRoutines, createRoutine, updateRoutine, deleteRoutine } from '../repos/routines';
import { callDinner } from '../repos/dinnerCalls';
import { getDayPlan } from '../repos/dayPlan';
import { broker } from '../realtime';
import { parseBody } from './helpers';
import { todayBrisbane } from '../util/time';
import { registerCrud } from './crud';

export async function routineRoutes(app: FastifyInstance): Promise<void> {
  registerCrud(app, {
    prefix: '/api/routines',
    channel: 'routines',
    create: routineCreate,
    update: routineUpdate,
    repo: {
      list: listRoutines,
      create: createRoutine,
      update: updateRoutine,
      remove: deleteRoutine,
    },
  });

  app.get('/api/routine-settings', async () => getRoutineSettings());

  app.put('/api/routine-settings', async (req) => {
    const settings = updateRoutineSettings(parseBody(routineSettingsUpdate, req.body));
    broker.poke('routines');
    return settings;
  });

  app.get('/api/day-plan', async (req) => {
    const { date } = parseBody(dayPlanQuery, req.query ?? {});
    return getDayPlan(date ?? todayBrisbane());
  });

  // The call itself is the event: clients (TV, wall) react to the SSE poke;
  // the stored row lets a client that reconnects later still see it in /api/day-plan.
  app.post('/api/dinner-calls', async (_req, reply) => {
    const call = callDinner();
    broker.poke('dinner-call', call);
    reply.status(201);
    return call;
  });
}
