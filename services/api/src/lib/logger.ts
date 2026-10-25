import pino from 'pino';

/** Ids only in logs, never personal data (PLAN 5.5). */
export const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  redact: ['*.secret', '*.apiKey', '*.authorization', 'req.headers.authorization'],
  ...(process.env['NODE_ENV'] !== 'production' ? { transport: { target: 'pino-pretty', options: { colorize: true } } } : {}),
});
