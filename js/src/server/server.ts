import { Log } from '../util/log';
import { describeRoute, validator, resolver } from 'hono-openapi';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { stream } from 'hono/streaming';
import { Session } from '../session';
import z from 'zod';
import { NamedError } from '../util/error';
import { MessageV2 } from '../session/message-v2';
import { Instance } from '../project/instance';
import { SessionPrompt } from '../session/prompt';
import { Storage } from '../storage/storage';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { lazy } from '../util/lazy';

const ERRORS = {
  400: {
    description: 'Bad request',
    content: {
      'application/json': {
        schema: resolver(
          z
            .object({
              data: z.any(),
              errors: z.array(z.record(z.string(), z.any())),
              success: z.literal(false),
            })
            .meta({
              ref: 'BadRequestError',
            })
        ),
      },
    },
  },
  404: {
    description: 'Not found',
    content: {
      'application/json': {
        schema: resolver(Storage.NotFoundError.Schema),
      },
    },
  },
} as const;

function errors(...codes: number[]) {
  return Object.fromEntries(
    codes.map((code) => [code, ERRORS[code as keyof typeof ERRORS]])
  );
}

export namespace Server {
  const log = Log.create({ service: 'server' });

  const app = new Hono();
  export const App = lazy(() =>
    app
      .onError((err, c) => {
        log.error(() => ({ message: 'failed', error: err }));
        if (err instanceof NamedError) {
          let status: ContentfulStatusCode;
          if (err instanceof Storage.NotFoundError) status = 404;
          else status = 500;
          return c.json(err.toObject(), { status });
        }
        const message =
          err instanceof Error && err.stack ? err.stack : err.toString();
        return c.json(new NamedError.Unknown({ message }).toObject(), {
          status: 500,
        });
      })
      .use(async (c, next) => {
        log.info(() => ({
          message: 'request',
          method: c.req.method,
          path: c.req.path,
        }));
        const timer = log.time('request', {
          method: c.req.method,
          path: c.req.path,
        });
        await next();
        timer.stop();
      })
      .use(cors())
      .get('/health', (c) => {
        return c.json({ status: 'ok' });
      })
      .post(
        '/session',
        describeRoute({
          description: 'Create a new session',
          operationId: 'session.create',
          responses: {
            200: {
              description: 'Created session',
              content: {
                'application/json': {
                  schema: resolver(Session.Info),
                },
              },
            },
          },
        }),
        validator(
          'json',
          z.object({ title: z.string().optional() }).optional()
        ),
        async (c) => {
          const body = c.req.valid('json') || {};
          const session = await Session.create({
            title: body.title,
          });
          return c.json(session);
        }
      )
      .get(
        '/session',
        describeRoute({
          description: 'List all sessions',
          operationId: 'session.list',
          responses: {
            200: {
              description: 'List of sessions',
              content: {
                'application/json': {
                  schema: resolver(Session.Info.array()),
                },
              },
            },
          },
        }),
        async (c) => {
          const sessions = await Session.list();
          return c.json(sessions);
        }
      )
      .get(
        '/session/:id',
        describeRoute({
          description: 'Get a session',
          operationId: 'session.get',
          responses: {
            200: {
              description: 'Session info',
              content: {
                'application/json': {
                  schema: resolver(Session.Info),
                },
              },
            },
            ...errors(404),
          },
        }),
        validator(
          'param',
          z.object({
            id: z.string(),
          })
        ),
        async (c) => {
          const session = await Session.get(c.req.valid('param').id);
          return c.json(session);
        }
      )
      .post(
        '/session/:id/message',
        describeRoute({
          description: 'Create and send a new message to a session',
          operationId: 'session.prompt',
          responses: {
            200: {
              description: 'Created message',
              content: {
                'application/json': {
                  schema: resolver(
                    z.object({
                      info: MessageV2.Assistant,
                      parts: MessageV2.Part.array(),
                    })
                  ),
                },
              },
            },
            ...errors(400, 404),
          },
        }),
        validator(
          'param',
          z.object({
            id: z.string().meta({ description: 'Session ID' }),
          })
        ),
        validator('json', SessionPrompt.PromptInput.omit({ sessionID: true })),
        async (c) => {
          c.status(200);
          c.header('Content-Type', 'application/json');
          return stream(c, async (stream) => {
            const sessionID = c.req.valid('param').id;
            const body = c.req.valid('json');
            const msg = await SessionPrompt.prompt({ ...body, sessionID });
            stream.write(JSON.stringify(msg));
          });
        }
      )
      .get(
        '/session/:id/message',
        describeRoute({
          description: 'List messages for a session',
          operationId: 'session.messages',
          responses: {
            200: {
              description: 'List of messages',
              content: {
                'application/json': {
                  schema: resolver(MessageV2.WithParts.array()),
                },
              },
            },
            ...errors(400, 404),
          },
        }),
        validator(
          'param',
          z.object({
            id: z.string().meta({ description: 'Session ID' }),
          })
        ),
        validator(
          'query',
          z.object({
            limit: z.coerce.number().optional(),
          })
        ),
        async (c) => {
          const query = c.req.valid('query');
          const messages = await Session.messages({
            sessionID: c.req.valid('param').id,
            limit: query.limit,
          });
          return c.json(messages);
        }
      )
  );

  export function listen(opts: { port: number; hostname: string }) {
    const server = Bun.serve({
      port: opts.port,
      hostname: opts.hostname,
      idleTimeout: 0,
      fetch: App().fetch,
    });
    return server;
  }
}
