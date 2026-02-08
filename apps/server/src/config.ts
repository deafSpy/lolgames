import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

// Get the directory of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Load environment variables based on NODE_ENV
 * Priority:
 * 1. .env.local (highest priority, git-ignored)
 * 2. .env.{NODE_ENV} (environment-specific)
 * 3. .env (fallback)
 *
 * On Render, environment variables are set in the dashboard,
 * so this loading is primarily for local development.
 */
const nodeEnv = process.env.NODE_ENV || "development";

// Load environment-specific file first
const envPath = resolve(__dirname, "..", `.env.${nodeEnv}`);
loadEnv({ path: envPath });

// Load .env as fallback (won't override existing vars)
loadEnv({ path: resolve(__dirname, "..", ".env") });

export const config = {
  // Server
  // On Render, PORT is automatically injected and should not be overridden
  port: parseInt(process.env.PORT || "3001", 10),
  host: process.env.HOST || "0.0.0.0",
  nodeEnv,

  // CORS - In development allow all, in production use specific origin
  corsOrigin: process.env.CORS_ORIGIN || (nodeEnv === "production" ? "" : "*"),

  // Backend URL for OAuth callbacks
  backendUrl: process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3001}`,

  // Redis (optional, for scaling and persistence)
  redis: {
    enabled: process.env.REDIS_ENABLED === "true",
    url: process.env.REDIS_URL || "redis://localhost:6379",
  },

  // Database (optional, for persistence)
  // CRITICAL in production: Render Free Tier spins down after 15 min
  // Without database, all game state is lost on restart
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
    level: process.env.LOG_LEVEL || (nodeEnv === "production" ? "info" : "debug"),
    pretty: process.env.LOG_PRETTY !== "false",
  },
} as const;

export type Config = typeof config;
