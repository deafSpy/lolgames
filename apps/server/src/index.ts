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
import { runMigrations } from "./migrations/index.js";
import { registerAuth } from "./auth.js";
import { registerHistoryRoutes } from "./routes/history.js";
import { registerLeaderboardRoutes } from "./routes/leaderboard.js";
import { registerStatsRoutes } from "./routes/stats.js";
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

  // Health check endpoint (enhanced with database and Redis status)
  app.get("/health", async () => {
    const dbHealth = config.database.enabled
      ? await database.healthCheck()
      : { status: "disabled" };
    const redisHealth = config.redis.enabled
      ? await redisService.healthCheck()
      : { status: "disabled" };

    return {
      status: dbHealth ? "ok" : "degraded",
      timestamp: Date.now(),
      uptime: process.uptime(),
      services: {
        database: {
          enabled: config.database.enabled,
          connected: database.connected,
          healthy: dbHealth,
        },
        redis: {
          enabled: config.redis.enabled,
          connected: redisService.connected,
          healthy: redisHealth,
        },
      },
    };
  });

  // Test endpoint to check environment variables
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

  // Auth routes (Express mounted inside Fastify)
  console.log("🔐 Registering auth routes...");
  await registerAuth(app);
  console.log("✅ Auth routes registered successfully");

  // API routes
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
    devMode: true,
  });

  // Define game rooms - show all rooms (waiting and in-progress)
  gameServer.define("connect4", Connect4Room).enableRealtimeListing().filterBy(["status"]); // Allow filtering, show all statuses

  gameServer.define("rps", RPSRoom).enableRealtimeListing().filterBy(["status"]);

  gameServer.define("quoridor", QuoridorRoom).enableRealtimeListing().filterBy(["status"]);

  gameServer.define("sequence", SequenceRoom).enableRealtimeListing().filterBy(["status"]);

  gameServer.define("splendor", SplendorRoom).enableRealtimeListing().filterBy(["status"]);

  gameServer.define("monopoly_deal", MonopolyDealRoom).enableRealtimeListing().filterBy(["status"]);

  gameServer.define("blackjack", BlackjackRoom).enableRealtimeListing().filterBy(["status"]);

  // Bot rooms - also show in lobby for spectating
  gameServer.define("connect4_bot", Connect4BotRoom).enableRealtimeListing().filterBy(["status"]);

  gameServer.define("rps_bot", RPSBotRoom).enableRealtimeListing().filterBy(["status"]);

  gameServer.define("quoridor_bot", QuoridorBotRoom).enableRealtimeListing().filterBy(["status"]);

  gameServer.define("sequence_bot", SequenceBotRoom).enableRealtimeListing().filterBy(["status"]);

  gameServer.define("splendor_bot", SplendorBotRoom).enableRealtimeListing().filterBy(["status"]);

  gameServer
    .define("monopoly_deal_bot", MonopolyDealBotRoom)
    .enableRealtimeListing()
    .filterBy(["status"]);

  gameServer.define("blackjack_bot", BlackjackBotRoom).enableRealtimeListing().filterBy(["status"]);

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

      // Step 2: Close HTTP server
      logger.info("Closing HTTP server...");
      await app.close();

      // Step 3: Close database connections
      if (config.database.enabled && database.connected) {
        logger.info("Closing database connections...");
        await database.close();
      }

      // Step 4: Close Redis connections
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
