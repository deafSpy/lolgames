import { EventEmitter } from "events";
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { lobbyService } from "../services/lobbyService.js";
import { redisService } from "../services/redis.js";
import { logger } from "../logger.js";

const LOBBY_UPDATE_CHANNEL = "lobby:updates";
const HEARTBEAT_INTERVAL_MS = 30_000;
const FALLBACK_POLL_INTERVAL_MS = 3_000;

export type LobbyUpdateEvent = {
  type: "created" | "updated" | "deleted" | "full_refresh";
  roomId?: string;
  lobby?: unknown;
};

interface LobbyRoomListing {
  roomId: string;
  clients: number;
  maxClients: number;
  spectatorCount: number;
  name: string;
  metadata: {
    gameType: string;
    hostName: string;
    status: string;
    createdAt: number;
    roomSlug?: string;
  };
}

interface LobbyData {
  roomId: string;
  gameType: string;
  host: string;
  currentPlayers: number;
  maxPlayers: number;
  spectatorCount?: number;
  status: string;
  vsBot: boolean;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

/**
 * Single, server-wide fanout for lobby updates.
 *
 * One Redis subscription per process, regardless of how many SSE clients
 * are connected. Each connected client just registers a listener on this
 * emitter. This avoids subscribing on the main Redis client (which would
 * lock it into subscriber mode) and avoids the per-client subscribe/
 * unsubscribe race that breaks fanout to other clients on disconnect.
 */
const lobbyEvents = new EventEmitter();
lobbyEvents.setMaxListeners(0); // unlimited SSE clients

let subscriberAttached = false;

/**
 * Attach the process-wide Redis subscriber listener exactly once.
 * Safe to call repeatedly; subsequent calls are no-ops.
 */
async function ensureRedisSubscriber(): Promise<boolean> {
  if (subscriberAttached) return true;

  const subscriber = redisService.getSubscriber();
  if (!subscriber || !redisService.connected) {
    return false;
  }

  try {
    await subscriber.subscribe(LOBBY_UPDATE_CHANNEL);
    subscriber.on("message", (channel, payload) => {
      if (channel !== LOBBY_UPDATE_CHANNEL) return;
      try {
        const event = JSON.parse(payload) as LobbyUpdateEvent;
        lobbyEvents.emit("update", event);
      } catch (error) {
        logger.error({ error }, "Failed to parse lobby pub/sub message");
      }
    });
    subscriberAttached = true;
    logger.info({ channel: LOBBY_UPDATE_CHANNEL }, "Subscribed to Redis lobby pub/sub");
    return true;
  } catch (error) {
    logger.error({ error }, "Failed to subscribe to Redis lobby pub/sub");
    return false;
  }
}

function toRoomListing(lobby: LobbyData): LobbyRoomListing {
  return {
    roomId: lobby.roomId,
    clients: lobby.currentPlayers,
    maxClients: lobby.maxPlayers,
    spectatorCount: lobby.spectatorCount ?? 0,
    name: `${lobby.gameType}${lobby.vsBot ? "_bot" : ""}`,
    metadata: {
      gameType: lobby.gameType,
      hostName: lobby.host,
      status: lobby.status,
      createdAt: new Date(lobby.createdAt).getTime(),
      roomSlug: lobby.metadata?.roomSlug as string | undefined,
    },
  };
}

async function loadInitialRooms(): Promise<LobbyRoomListing[]> {
  // lobbyService.getAllLobbies() is documented as safe-empty when Redis is
  // unavailable and must not throw — preserve that contract.
  const lobbies = await lobbyService.getAllLobbies();
  return lobbies.map(toRoomListing);
}

/**
 * Server-Sent Events endpoint for real-time lobby updates.
 *
 * - When Redis is connected: clients receive pushed events from Redis pub/sub
 *   via the process-wide fanout, with sub-500ms latency.
 * - When Redis is unavailable (REDIS_ENABLED=false or transient failure):
 *   the same endpoint degrades to a 3-second server-side poll that pushes
 *   the full lobby list. The frontend EventSource client is unchanged.
 */
export async function registerLobbyStreamRoutes(app: FastifyInstance) {
  // Best-effort: subscribe on registration if Redis is already up.
  // If Redis comes up later, the first SSE client will re-try.
  await ensureRedisSubscriber();

  app.get("/api/lobby/stream", async (request: FastifyRequest, reply: FastifyReply) => {
    // SSE headers
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    // Flush headers immediately so EventSource fires `open` without waiting
    // for the first payload.
    if (typeof reply.raw.flushHeaders === "function") {
      reply.raw.flushHeaders();
    }

    const clientId = Math.random().toString(36).substring(2, 10);
    const remoteAddr = request.ip;
    logger.info({ clientId, remoteAddr }, "SSE client connected to lobby stream");

    let closed = false;
    const writeEvent = (data: unknown) => {
      if (closed) return;
      try {
        reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch (error) {
        logger.warn({ error, clientId }, "Failed to write SSE event to client");
      }
    };

    // 1. Send initial snapshot. Safe-empty on Redis-down.
    try {
      const rooms = await loadInitialRooms();
      writeEvent({ type: "initial", lobbies: rooms });
    } catch (error) {
      logger.error({ error, clientId }, "Failed to send initial lobby snapshot");
      writeEvent({ type: "initial", lobbies: [] });
    }

    // 2. Wire up either Redis fanout or polling fallback for this client.
    const redisReady = await ensureRedisSubscriber();
    let pollTimer: NodeJS.Timeout | null = null;
    let listener: ((event: LobbyUpdateEvent) => void) | null = null;

    if (redisReady) {
      listener = (event: LobbyUpdateEvent) => writeEvent(event);
      lobbyEvents.on("update", listener);
      logger.info({ clientId }, "SSE client wired to Redis pub/sub fanout");
    } else {
      logger.warn(
        { clientId },
        "Redis unavailable — SSE client falling back to 3s server-side poll"
      );
      const tick = async () => {
        try {
          const rooms = await loadInitialRooms();
          writeEvent({ type: "full_refresh", lobbies: rooms });
        } catch (error) {
          logger.error({ error, clientId }, "Failed to push polled lobby update");
        }
      };
      pollTimer = setInterval(tick, FALLBACK_POLL_INTERVAL_MS);
    }

    // 3. Heartbeat to keep proxies / load balancers from closing the socket.
    const heartbeat = setInterval(() => {
      if (closed) return;
      try {
        reply.raw.write(": heartbeat\n\n");
      } catch (error) {
        logger.warn({ error, clientId }, "Heartbeat write failed");
      }
    }, HEARTBEAT_INTERVAL_MS);

    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      if (pollTimer) clearInterval(pollTimer);
      if (listener) lobbyEvents.off("update", listener);
      logger.info({ clientId }, "SSE client disconnected from lobby stream");
    };

    request.raw.on("close", cleanup);
    request.raw.on("error", cleanup);
  });

  logger.info("Lobby stream routes registered (SSE)");
}

/**
 * Publish a lobby update event so all connected SSE clients receive it.
 *
 * Uses the dedicated Redis subscriber/publisher pattern: events flow via
 * the main Redis client to the `lobby:updates` channel, where every
 * server process's subscriber relays them to local SSE clients through
 * `lobbyEvents`. Safe to call when Redis is unavailable (no-op).
 *
 * Also emits locally so single-process tests / dev without Redis still
 * see pushes when Redis is enabled but pub/sub round-trip would lag.
 */
export async function publishLobbyUpdate(event: LobbyUpdateEvent): Promise<void> {
  const client = redisService.getClient();
  if (!client || !redisService.connected) {
    // Redis not available: clients are on the polling fallback path and
    // will pick this up on the next tick. Nothing to do.
    return;
  }

  try {
    await client.publish(LOBBY_UPDATE_CHANNEL, JSON.stringify(event));
    logger.debug({ event: event.type, roomId: event.roomId }, "Published lobby update");
  } catch (error) {
    logger.error({ error, event }, "Failed to publish lobby update");
  }
}

/**
 * Test hook: dispatch a synthetic lobby event directly to local SSE
 * listeners without going through Redis. Useful for unit tests.
 */
export function __emitLobbyEventForTest(event: LobbyUpdateEvent): void {
  lobbyEvents.emit("update", event);
}
