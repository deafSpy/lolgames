import { config as loadEnv } from "dotenv";

// Load environment variables at startup
loadEnv();

import Fastify from "fastify";
import cors from "@fastify/cors";
import { Server, matchMaker } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { database } from "./services/database.js";
import { redisService } from "./services/redis.js";
import { outboxFlusher } from "./services/outboxFlusher.js";
import { runMigrations } from "./migrations/index.js";
import { registerAuth } from "./auth.js";
import { registerHistoryRoutes } from "./routes/history.js";
import { registerLeaderboardRoutes } from "./routes/leaderboard.js";
import { registerStatsRoutes } from "./routes/stats.js";
import { registerRoomRoutes } from "./routes/rooms.js";
import { registerLobbyStreamRoutes } from "./routes/lobby-stream.js";
import { Connect4Room } from "./rooms/Connect4Room.js";
import { RPSRoom } from "./rooms/RPSRoom.js";
import { Connect4BotRoom } from "./rooms/Connect4BotRoom.js";
import { RPSBotRoom } from "./rooms/RPSBotRoom.js";
import { QuoridorBotRoom } from "./rooms/QuoridorBotRoom.js";
import { QuoridorRoom } from "./rooms/QuoridorRoom.js";
import { SequenceRoom } from "./rooms/SequenceRoom.js";
import { SequenceBotRoom } from "./rooms/SequenceBotRoom.js";
import { SplendorRoom } from "./rooms/SplendorRoom.js";
import { SplendorBotRoom } from "./rooms/SplendorBotRoom.js";
import { MonopolyDealRoom } from "./rooms/MonopolyDealRoom.js";
import { MonopolyDealBotRoom } from "./rooms/MonopolyDealBotRoom.js";
import { BlackjackRoom } from "./rooms/BlackjackRoom.js";
import { BlackjackBotRoom } from "./rooms/BlackjackBotRoom.js";

async function bootstrap() {
  logger.info("");
  logger.info("═══════════════════════════════════════════");
  logger.info("🚀 INITIALIZING SERVICES");
  logger.info("═══════════════════════════════════════════");
  logger.info("");

  // Step 1: Initialize database connection
  if (config.database.enabled) {
    try {
      await database.connect();

      // Step 2: Run database migrations
      logger.info("");
      logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      logger.info("🔄 RUNNING DATABASE MIGRATIONS");
      logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      await runMigrations();
      logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      logger.info("✅ MIGRATIONS COMPLETE");
      logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      logger.info("");

      // DEA-37: start the outbox flusher right after migrations land so any
      // rows left undelivered from a previous server lifetime are drained
      // before we start accepting new games.
      outboxFlusher.start();
    } catch (error) {
      logger.error(error, "❌ Database initialization failed");
      if (config.nodeEnv === "production") {
        // In production, exit if database fails
        logger.error("💥 EXITING - Database required in production");
        process.exit(1);
      } else {
        // In development, continue without database
        logger.warn("⚠️  CONTINUING WITHOUT DATABASE (in-memory mode)");
        logger.warn("   → This is OK for development");
        logger.warn("   → But games will NOT persist!");
        logger.info("");
      }
    }
  } else {
    logger.warn("⚠️  DATABASE DISABLED - using in-memory storage");
    logger.warn("   → Set DATABASE_ENABLED=true in .env to enable persistence");
    logger.info("");
  }

  // Step 3: Initialize Redis (optional)
  if (config.redis.enabled) {
    try {
      await redisService.connect();
    } catch (error) {
      logger.error(error, "❌ Redis connection failed");
      logger.warn("⚠️  Continuing without Redis (this is OK)");
      logger.info("");
    }
  } else {
    logger.info("ℹ️  REDIS DISABLED (not needed for single-server)");
    logger.info("   → Enable later when you need horizontal scaling");
    logger.info("");
  }

  // Create Fastify instance
  const app = Fastify({
    logger: false, // We use our own pino logger
  });

  // Register CORS - Allow all origins in development
  await app.register(cors, {
    origin: config.nodeEnv === "production" ? config.corsOrigin : true,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Accept", "Authorization"],
  });

  // Health check endpoint (enhanced with database, Redis, and outbox status)
  app.get("/health", async () => {
    const dbOk = config.database.enabled ? await database.healthCheck() : true;
    const redisOk = config.redis.enabled ? await redisService.healthCheck() : true;
    const outboxHealth = await outboxFlusher.getHealth();

    return {
      status: dbOk && redisOk ? "ok" : "degraded",
      timestamp: Date.now(),
      uptime: process.uptime(),
      services: {
        database: {
          enabled: config.database.enabled,
          connected: database.connected,
          healthy: dbOk,
        },
        redis: {
          enabled: config.redis.enabled,
          connected: redisService.connected,
          healthy: redisOk,
        },
        outbox: {
          enabled: outboxHealth.enabled,
          running: outboxHealth.running,
          undelivered_count: outboxHealth.undeliveredCount,
          oldest_undelivered_age_seconds: outboxHealth.oldestUndeliveredAgeSeconds,
          last_flushed_at: outboxHealth.lastFlushedAt,
        },
      },
    };
  });

  // Test endpoint — development only, gated out of production
  if (config.nodeEnv !== "production") {
    app.get("/test-env", async () => {
      return {
        cwd: process.cwd(),
        env: {
          JWT_SECRET: !!process.env.JWT_SECRET,
          GOOGLE_CLIENT_ID: !!process.env.GOOGLE_CLIENT_ID,
          GOOGLE_CLIENT_SECRET: !!process.env.GOOGLE_CLIENT_SECRET,
          BACKEND_URL: process.env.BACKEND_URL,
          NODE_ENV: process.env.NODE_ENV,
          DATABASE_ENABLED: config.database.enabled,
          REDIS_ENABLED: config.redis.enabled,
        },
      };
    });
  }

  // Auth routes (Express mounted inside Fastify)
  console.log("🔐 Registering auth routes...");
  await registerAuth(app);
  console.log("✅ Auth routes registered successfully");

  // API routes (excluding room routes which need gameServer)
  console.log("📊 Registering API routes...");
  await registerHistoryRoutes(app);
  await registerLeaderboardRoutes(app);
  await registerStatsRoutes(app);
  console.log("✅ API routes registered successfully");

  // API info endpoint
  app.get("/", async () => {
    return {
      name: "Multiplayer Games Server",
      version: "0.1.0",
      games: ["connect4", "rps", "quoridor", "sequence", "splendor", "monopoly_deal", "blackjack"],
      botGames: [
        "connect4_bot",
        "rps_bot",
        "quoridor_bot",
        "sequence_bot",
        "splendor_bot",
        "monopoly_deal_bot",
        "blackjack_bot",
      ],
    };
  });

  // Matchmaker endpoint - get all available rooms (registered BEFORE gameServer)
  // Note: Can't use /matchmake as Colyseus reserves that route
  console.log("📋 Registering /api/rooms route...");
  app.get("/api/rooms", async (request) => {
    console.log("✅ API ROOMS REQUEST RECEIVED:", request.url);
    logger.info("API rooms endpoint called");
    try {
      const connect4Rooms = await matchMaker.query({ name: "connect4" });
      const rpsRooms = await matchMaker.query({ name: "rps" });
      const quoridorRooms = await matchMaker.query({ name: "quoridor" });
      const sequenceRooms = await matchMaker.query({ name: "sequence" });
      const catanRooms = await matchMaker.query({ name: "catan" });
      const splendorRooms = await matchMaker.query({ name: "splendor" });
      const monopolyDealRooms = await matchMaker.query({ name: "monopoly_deal" });
      const blackjackRooms = await matchMaker.query({ name: "blackjack" });

      // Also query bot rooms for testing purposes
      const connect4BotRooms = await matchMaker.query({ name: "connect4_bot" });
      const rpsBotRooms = await matchMaker.query({ name: "rps_bot" });
      const quoridorBotRooms = await matchMaker.query({ name: "quoridor_bot" });
      const sequenceBotRooms = await matchMaker.query({ name: "sequence_bot" });
      const splendorBotRooms = await matchMaker.query({ name: "splendor_bot" });
      const monopolyDealBotRooms = await matchMaker.query({ name: "monopoly_deal_bot" });
      const blackjackBotRooms = await matchMaker.query({ name: "blackjack_bot" });

      const allRooms = [
        ...connect4Rooms,
        ...rpsRooms,
        ...quoridorRooms,
        ...sequenceRooms,
        ...catanRooms,
        ...splendorRooms,
        ...monopolyDealRooms,
        ...blackjackRooms,
        ...connect4BotRooms,
        ...rpsBotRooms,
        ...quoridorBotRooms,
        ...sequenceBotRooms,
        ...splendorBotRooms,
        ...monopolyDealBotRooms,
        ...blackjackBotRooms,
      ];
      logger.info(
        {
          roomCount: allRooms.length,
          roomTypes: {
            connect4: connect4Rooms.length,
            rps: rpsRooms.length,
            quoridor: quoridorRooms.length,
            sequence: sequenceRooms.length,
            catan: catanRooms.length,
            splendor: splendorRooms.length,
            monopolyDeal: monopolyDealRooms.length,
            blackjack: blackjackRooms.length,
            connect4Bot: connect4BotRooms.length,
            rpsBot: rpsBotRooms.length,
            quoridorBot: quoridorBotRooms.length,
            sequenceBot: sequenceBotRooms.length,
            splendorBot: splendorBotRooms.length,
            monopolyDealBot: monopolyDealBotRooms.length,
            blackjackBot: blackjackBotRooms.length,
          },
        },
        "Matchmaker queried all rooms"
      );
      return allRooms;
    } catch (error) {
      logger.error(error, "Failed to query rooms");
      return [];
    }
  });

  // Matchmaker endpoint - get rooms by game type
  console.log("📋 Registering /api/rooms/:gameType route...");
  app.get("/api/rooms/:gameType", async (request) => {
    const { gameType } = request.params as { gameType: string };
    try {
      const rooms = await matchMaker.query({ name: gameType });
      return rooms;
    } catch (error) {
      logger.error(error, `Failed to query ${gameType} rooms`);
      return [];
    }
  });

  // Create Colyseus game server
  const gameServer = new Server({
    transport: new WebSocketTransport({
      server: app.server,
    }),
    devMode: config.nodeEnv !== "production",
  });

  // Define game rooms - show all rooms (waiting and in-progress).
  //
  // The third arg `{ maxPlayers }` is Colyseus' per-room-type default options.
  // It is merged with client-provided JoinOptions at create time with the
  // server defaults winning (see MatchMaker.create → merge(clientOptions, handler.options)),
  // so the lobby and the persisted matches row record the authoritative seat
  // count per game type. Phase 2 multi-player variants will pass overrides
  // through onCreate options for room-config-driven games.
  gameServer
    .define("connect4", Connect4Room, { maxPlayers: 2 })
    .enableRealtimeListing()
    .filterBy(["status"]); // Allow filtering, show all statuses

  gameServer.define("rps", RPSRoom, { maxPlayers: 2 }).enableRealtimeListing().filterBy(["status"]);

  // Quoridor: 2p today; the 4p variant arrives in Phase 2 via room config.
  gameServer
    .define("quoridor", QuoridorRoom, { maxPlayers: 2 })
    .enableRealtimeListing()
    .filterBy(["status"]);

  // Sequence supports 2/3/4 (teams). Upper bound so the slug-routed share URL
  // can fill correctly.
  gameServer
    .define("sequence", SequenceRoom, { maxPlayers: 4 })
    .enableRealtimeListing()
    .filterBy(["status"]);

  // Splendor: 2-4.
  gameServer
    .define("splendor", SplendorRoom, { maxPlayers: 4 })
    .enableRealtimeListing()
    .filterBy(["status"]);

  // Monopoly Deal: 2-5.
  gameServer
    .define("monopoly_deal", MonopolyDealRoom, { maxPlayers: 5 })
    .enableRealtimeListing()
    .filterBy(["status"]);

  // Blackjack: always 2 (player vs dealer table).
  gameServer
    .define("blackjack", BlackjackRoom, { maxPlayers: 2 })
    .enableRealtimeListing()
    .filterBy(["status"]);

  // Bot rooms - 1v1 (human + bot), always 2 seats.
  gameServer
    .define("connect4_bot", Connect4BotRoom, { maxPlayers: 2 })
    .enableRealtimeListing()
    .filterBy(["status"]);

  gameServer
    .define("rps_bot", RPSBotRoom, { maxPlayers: 2 })
    .enableRealtimeListing()
    .filterBy(["status"]);

  gameServer
    .define("quoridor_bot", QuoridorBotRoom, { maxPlayers: 2 })
    .enableRealtimeListing()
    .filterBy(["status"]);

  gameServer
    .define("sequence_bot", SequenceBotRoom, { maxPlayers: 2 })
    .enableRealtimeListing()
    .filterBy(["status"]);

  gameServer
    .define("splendor_bot", SplendorBotRoom, { maxPlayers: 2 })
    .enableRealtimeListing()
    .filterBy(["status"]);

  gameServer
    .define("monopoly_deal_bot", MonopolyDealBotRoom, { maxPlayers: 2 })
    .enableRealtimeListing()
    .filterBy(["status"]);

  gameServer
    .define("blackjack_bot", BlackjackBotRoom, { maxPlayers: 2 })
    .enableRealtimeListing()
    .filterBy(["status"]);

  // Register room routes that need gameServer (after gameServer is initialized)
  console.log("📋 Registering room slug routes...");
  await registerRoomRoutes(app, gameServer);
  await registerLobbyStreamRoutes(app);
  console.log("✅ Room routes registered successfully");

  // Start Fastify server (HTTP only) - AFTER game server is fully initialized
  await app.listen({ port: config.port, host: config.host });

  logger.info("");
  logger.info("═══════════════════════════════════════════");
  logger.info("🎮 SERVER READY!");
  logger.info("═══════════════════════════════════════════");
  logger.info(`HTTP server: http://${config.host}:${config.port}`);
  logger.info(`WebSocket: ws://${config.host}:${config.port}`);
  logger.info(`Environment: ${config.nodeEnv}`);
  logger.info("");
  logger.info("📊 Service Status:");
  logger.info(`   Database: ${database.connected ? "✅ Connected" : "❌ Not Connected"}`);
  logger.info(
    `   Redis: ${redisService.connected ? "✅ Connected" : config.redis.enabled ? "❌ Not Connected" : "⚪ Disabled"}`
  );
  logger.info("");
  logger.info("🎯 Available endpoints:");
  logger.info("   GET  /health          - Health check");
  logger.info("   GET  /history         - Game history");
  logger.info("   GET  /leaderboard     - Rankings");
  logger.info("   GET  /stats           - Player statistics");
  logger.info("   GET  /api/rooms       - Available rooms");
  logger.info("   POST /auth/register   - User registration");
  logger.info("   POST /auth/login      - User login");
  logger.info("");

  // Listen for Colyseus events
  gameServer.onShutdown(() => {
    logger.info("Game server shutting down...");
  });

  // Graceful shutdown
  const shutdown = async () => {
    logger.info("🛑 Received shutdown signal");

    try {
      // Step 1: Stop accepting new connections
      logger.info("Shutting down game server...");
      await gameServer.gracefullyShutdown();

      // Step 2: Stop the outbox flusher tick before tearing down the DB.
      await outboxFlusher.stop();

      // Step 3: Close HTTP server
      logger.info("Closing HTTP server...");
      await app.close();

      // Step 4: Close database connections
      if (config.database.enabled && database.connected) {
        logger.info("Closing database connections...");
        await database.close();
      }

      // Step 5: Close Redis connections
      if (config.redis.enabled && redisService.connected) {
        logger.info("Closing Redis connections...");
        await redisService.disconnect();
      }

      logger.info("✅ Graceful shutdown complete");
      process.exit(0);
    } catch (error) {
      logger.error(error, "❌ Error during shutdown");
      process.exit(1);
    }
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

bootstrap().catch((err) => {
  logger.error(err, "Failed to start server");
  process.exit(1);
});
