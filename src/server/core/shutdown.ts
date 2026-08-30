/** Graceful shutdown handling: closes open handles/db on process signals. */
import type { DB } from './db';

/**
 * Structural types so tests can pass minimal fakes instead of real servers.
 * http.Server and ws.WebSocketServer both satisfy these.
 */
export interface CloseHandle {
  close(callback?: () => void): unknown;
}

export interface WsServerHandle extends CloseHandle {
  clients: Set<{ terminate(): void }>;
}

export interface ShutdownOptions {
  /** HTTP listener; close() stops accepting new connections. */
  server: CloseHandle;
  /** WebSocket server; live clients are terminated, then the server closes. */
  wss?: WsServerHandle;
  db?: Pick<DB, 'close'>;
  /** Background intervals (e.g. the room/session janitor) to stop. */
  cleanupTimer?: NodeJS.Timeout;
  /**
   * Injectable exit so tests can observe termination without killing the
   * process. Defaults to process.exit.
   */
  exit?: (code: number) => void;
  /** Max wait for open connections before forcing shutdown (ms). */
  timeoutMs?: number;
}

/**
 * Build an idempotent shutdown handler: stop timers, terminate WS clients,
 * close the HTTP + WS listeners (bounded by `timeoutMs`), close the database
 * last so in-flight writes land first, then exit.
 */
export function createGracefulShutdown(
  options: ShutdownOptions
): (signal?: string) => Promise<void> {
  const exit = options.exit ?? ((code: number) => process.exit(code));
  let inProgress = false;

  return async function shutdown(signal = ''): Promise<void> {
    if (inProgress) return;
    inProgress = true;

    if (options.cleanupTimer) clearInterval(options.cleanupTimer);
    if (signal) console.log(`[server] ${signal} received — shutting down...`);

    // Drop live sockets immediately; wss.close() then fires its callback once
    // every client has disconnected and no new handshakes are accepted.
    if (options.wss) {
      for (const client of options.wss.clients) client.terminate();
    }

    const transportsClosed = Promise.all([
      new Promise<void>((resolve) => options.server.close(() => resolve())),
      options.wss
        ? new Promise<void>((resolve) => options.wss!.close(() => resolve()))
        : Promise.resolve(),
    ]);

    const timeoutMs = options.timeoutMs ?? 5000;
    const outcome = await Promise.race([
      transportsClosed.then(() => 'closed' as const),
      new Promise<'forced'>((resolve) =>
        setTimeout(() => resolve('forced'), timeoutMs)
      ),
    ]);
    if (outcome === 'forced') {
      console.error(
        `[server] open connections did not close within ${timeoutMs}ms — forcing shutdown`
      );
    }

    try {
      await options.db?.close();
    } catch (err) {
      console.error('[server] database close failed:', err);
    }
    exit(0);
  };
}

/** Wire SIGINT + SIGTERM (Docker/Kubernetes send SIGTERM) to one handler. */
export function registerShutdownHandlers(options: ShutdownOptions): void {
  const shutdown = createGracefulShutdown(options);
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}
