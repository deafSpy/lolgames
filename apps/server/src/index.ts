import { config as loadEnv } from "dotenv";

// Load environment variables at startup
loadEnv();

import Fastify from "fastify";
import cors from "@fastify/cors";
import { Server, matchMaker } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { registerAuth } from "./auth.js";
import { registerHistoryRoutes } from "./routes/history.js";
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
  // Create Fastify instance
  const app = Fastify({
    logger: false, // We use our own pino logger
  });

  // Register CORS - Allow all origins in development
  await app.register(cors, {
    origin: config.nodeEnv === 'production' ? config.corsOrigin : true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept', 'Authorization'],
  });

  // Health check endpoint
  app.get("/health", async () => {
    return {
      status: "ok",
      timestamp: Date.now(),
      uptime: process.uptime(),
    };
  });

  // Test endpoint to check environment variables
  app.get('/test-env', async () => {
    return {
      cwd: process.cwd(),
      env: {
        JWT_SECRET: !!process.env.JWT_SECRET,
        GOOGLE_CLIENT_ID: !!process.env.GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET: !!process.env.GOOGLE_CLIENT_SECRET,
        BACKEND_URL: process.env.BACKEND_URL,
        NODE_ENV: process.env.NODE_ENV
      }
    };
  });

  // Auth routes (Express mounted inside Fastify) + history API
  console.log('🔐 Registering auth routes...');
  await registerAuth(app);
  console.log('✅ Auth routes registered successfully');

  console.log('📊 Registering history routes...');
  await registerHistoryRoutes(app);
  console.log('✅ History routes registered successfully');

  // API info endpoint
  app.get("/", async () => {
    return {
      name: "Multiplayer Games Server",
      version: "0.1.0",
      games: ["connect4", "rps", "quoridor", "sequence", "splendor", "monopoly_deal", "blackjack"],
      botGames: ["connect4_bot", "rps_bot", "quoridor_bot", "sequence_bot", "splendor_bot", "monopoly_deal_bot", "blackjack_bot"],
    };
  });

  // Matchmaker endpoint - get all available rooms
  app.get("/matchmake", async (request) => {
    console.log("MATCHMAKE REQUEST RECEIVED:", request.url);
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
        ...connect4Rooms, ...rpsRooms, ...quoridorRooms, ...sequenceRooms, ...catanRooms, ...splendorRooms, ...monopolyDealRooms, ...blackjackRooms,
        ...connect4BotRooms, ...rpsBotRooms, ...quoridorBotRooms, ...sequenceBotRooms, ...splendorBotRooms, ...monopolyDealBotRooms, ...blackjackBotRooms
      ];
      logger.info({
        roomCount: allRooms.length,
        roomTypes: {
          connect4: connect4Rooms.length, rps: rpsRooms.length, quoridor: quoridorRooms.length, sequence: sequenceRooms.length,
          catan: catanRooms.length, splendor: splendorRooms.length, monopolyDeal: monopolyDealRooms.length, blackjack: blackjackRooms.length,
          connect4Bot: connect4BotRooms.length, rpsBot: rpsBotRooms.length, quoridorBot: quoridorBotRooms.length,
          sequenceBot: sequenceBotRooms.length, splendorBot: splendorBotRooms.length, monopolyDealBot: monopolyDealBotRooms.length, blackjackBot: blackjackBotRooms.length
        }
      }, "Matchmaker queried all rooms");
      return allRooms;
    } catch (error) {
      logger.error(error, "Failed to query rooms");
      return [];
    }
  });

  // Matchmaker endpoint - get rooms by game type
  app.get("/matchmake/:gameType", async (request) => {
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

  // Define game rooms
  gameServer.define("connect4", Connect4Room).enableRealtimeListing();
  gameServer.define("rps", RPSRoom).enableRealtimeListing();
  gameServer.define("quoridor", QuoridorRoom).enableRealtimeListing();
  gameServer.define("sequence", SequenceRoom).enableRealtimeListing();
  gameServer.define("splendor", SplendorRoom).enableRealtimeListing();
  gameServer.define("monopoly_deal", MonopolyDealRoom).enableRealtimeListing();
  gameServer.define("blackjack", BlackjackRoom).enableRealtimeListing();
  
  // Bot rooms (not listed in matchmaker - created on demand)
  gameServer.define("connect4_bot", Connect4BotRoom);
  gameServer.define("rps_bot", RPSBotRoom);
  gameServer.define("quoridor_bot", QuoridorBotRoom);
  gameServer.define("sequence_bot", SequenceBotRoom);
  gameServer.define("splendor_bot", SplendorBotRoom);
  gameServer.define("monopoly_deal_bot", MonopolyDealBotRoom);
  gameServer.define("blackjack_bot", BlackjackBotRoom);

  // Start Fastify server (HTTP only) - AFTER game server is fully initialized
  await app.listen({ port: config.port, host: config.host });
  logger.info(`HTTP server listening on http://${config.host}:${config.port}`);

  // Listen for Colyseus events
  gameServer.onShutdown(() => {
    logger.info("Game server shutting down...");
  });

  logger.info(`Game server ready at ws://${config.host}:${config.port}`);
  logger.info(`Environment: ${config.nodeEnv}`);

  // Graceful shutdown
  const shutdown = async () => {
    logger.info("Received shutdown signal");
    await gameServer.gracefullyShutdown();
    await app.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

bootstrap().catch((err) => {
  logger.error(err, "Failed to start server");
  process.exit(1);
});
