import { config as loadEnv } from "dotenv";

// Ensure environment variables are loaded
loadEnv();

import pino from "pino";
import { config } from "./config.js";

export const logger = pino({
  level: config.logging.level,
  transport: config.logging.pretty
    ? {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
          ignore: "pid,hostname",
        },
      }
    : undefined,
});

