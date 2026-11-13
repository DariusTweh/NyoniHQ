import { createError, defineEventHandler, getHeader } from 'nitro/h3';
import { runDueSchedules } from '../../../schedule-runner.js';

export default defineEventHandler(async (event) => {
  const authorization = getHeader(event, 'authorization');
  if (!process.env.CRON_SECRET || authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    throw createError({ statusCode: 401, statusMessage: 'Cron authorization required.' });
  }
  return runDueSchedules();
});
