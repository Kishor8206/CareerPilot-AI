import http from 'node:http';
import { createApp } from './app';
import { connectDatabase, disconnectDatabase } from './config/database';
import { env } from './config/env';
import { logger } from './config/logger';
import { configService } from './services/config.service';
import { initSocketServer } from './sockets';

async function bootstrap() {
  await connectDatabase();
  // Seeds APIE weights, monitoring thresholds and retention policy if absent.
  await configService.bootstrap();

  const app = createApp();
  const server = http.createServer(app);
  initSocketServer(server);

  server.listen(env.PORT, () => {
    logger.info(
      { port: env.PORT, env: env.NODE_ENV, api: env.API_PREFIX, aiService: env.AI_SERVICE_URL, demoMode: env.DEMO_MODE },
      `${env.APP_NAME} backend listening on http://localhost:${env.PORT}`,
    );
  });

  /** Drain in-flight requests before exiting so no user sees a truncated response. */
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    server.close(async () => {
      await disconnectDatabase();
      logger.info('Shutdown complete');
      process.exit(0);
    });
    setTimeout(() => {
      logger.error('Forced shutdown after 15s grace period');
      process.exit(1);
    }, 15_000).unref();
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'Unhandled promise rejection');
  });
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'Uncaught exception - exiting');
    process.exit(1);
  });
}

bootstrap().catch((error) => {
  logger.fatal({ err: error }, 'Failed to start the server');
  process.exit(1);
});
