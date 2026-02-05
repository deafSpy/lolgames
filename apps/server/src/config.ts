import { config as loadEnv } from "dotenv";

loadEnv();

export const config = {
  // Server
  port: parseInt(process.env.PORT || "3001", 10),
  host: process.env.HOST || "0.0.0.0",
  nodeEnv: process.env.NODE_ENV || "development",

  // CORS - Allow multiple origins in development
  corsOrigin: process.env.CORS_ORIGIN || "*",

  // Redis (optional, for scaling)
  redis: {
    enabled: process.env.REDIS_ENABLED === "true",
    url: process.env.REDIS_URL || "redis://localhost:6379",
  },

  // Database (optional, for persistence)
  database: {
    enabled: process.env.DATABASE_ENABLED === "true",
    url: process.env.DATABASE_URL || "postgresql://localhost:5432/multiplayer",
  },

  // Game settings
  game: {
    turnTimeLimit: parseInt(process.env.TURN_TIME_LIMIT || "30000", 10),
    maxPlayersPerRoom: parseInt(process.env.MAX_PLAYERS_PER_ROOM || "4", 10),
    roomDisposeTimeout: parseInt(process.env.ROOM_DISPOSE_TIMEOUT || "60000", 10),
    reconnectTimeout: parseInt(process.env.RECONNECT_TIMEOUT || "60000", 10),
  },

  // Logging
  logging: {
    level: process.env.LOG_LEVEL || "info",
    pretty: process.env.LOG_PRETTY !== "false",
  },
} as const;

export type Config = typeof config;

