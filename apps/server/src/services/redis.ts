import Redis from "ioredis";
import { config } from "../config.js";
import { logger } from "../logger.js";

/**
 * Redis service for session storage, caching, and pub/sub
 * Optional service - only initializes if REDIS_ENABLED=true
 */
class RedisService {
  private client: Redis | null = null;
  private subscriber: Redis | null = null;
  private isConnected = false;

  /**
   * Initialize Redis connection
   */
  async connect(): Promise<void> {
    logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    logger.info("📦 REDIS CONNECTION ATTEMPT");
    logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    if (!config.redis.enabled) {
      logger.warn("⚠️  REDIS_ENABLED=false - Redis features disabled");
      logger.warn("   → Session storage: Not available");
      logger.warn("   → Caching: Not available");
      logger.warn("   → Rate limiting: Not available");
      logger.warn("   → Pub/Sub: Not available");
      logger.info("   ℹ️  This is OK for single-server deployments");
      return;
    }

    logger.info("✓ REDIS_ENABLED=true");

    if (!config.redis.url) {
      logger.error("❌ REDIS_URL is missing!");
      throw new Error("REDIS_URL is required when REDIS_ENABLED=true");
    }

    // Log connection attempt (hide password)
    const urlForLogging = config.redis.url.replace(/:([^@]+)@/, ":****@");
    logger.info(`📡 Attempting connection to: ${urlForLogging}`);

    const isUpstash = config.redis.url.includes("upstash.io");
    const usesTLS = config.redis.url.startsWith("rediss://");
    logger.info(`   Environment: ${isUpstash ? "Upstash Cloud" : "Local/Other"}`);
    logger.info(`   TLS: ${usesTLS ? "Enabled (secure)" : "Disabled (local)"}`);

    try {
      // Create main Redis client with robust Upstash configuration
      this.client = new Redis(config.redis.url, {
        // 1. Prevent "MaxRetriesPerRequestError" - retry forever for long-running servers
        maxRetriesPerRequest: null,

        // 2. Keep connection alive - ping every 10s to prevent Upstash from closing socket
        keepAlive: 10000,

        enableReadyCheck: false, // Disable for Upstash
        connectTimeout: 20000,
        lazyConnect: false,
        family: 4, // Force IPv4

        // 3. Aggressive retry strategy
        retryStrategy: (times) => {
          const delay = Math.min(times * 50, 2000);
          logger.warn(`   ⟳ Retry attempt ${times}, waiting ${delay}ms...`);
          return delay;
        },

        // 4. Auto-reconnect on specific errors
        reconnectOnError: (err) => {
          const targetError = "READONLY";
          if (err.message.includes(targetError)) {
            return true;
          }
          return false;
        },

        // Upstash TLS configuration
        tls: usesTLS
          ? {
              rejectUnauthorized: false,
            }
          : undefined,
      });

      // Create separate subscriber client for pub/sub with same robust config
      this.subscriber = new Redis(config.redis.url, {
        maxRetriesPerRequest: null,
        keepAlive: 10000,
        enableReadyCheck: false,
        connectTimeout: 20000,
        lazyConnect: false,
        family: 4,
        retryStrategy: (times) => {
          const delay = Math.min(times * 50, 2000);
          return delay;
        },
        reconnectOnError: (err) => {
          const targetError = "READONLY";
          if (err.message.includes(targetError)) {
            return true;
          }
          return false;
        },
        tls: usesTLS
          ? {
              rejectUnauthorized: false,
            }
          : undefined,
      });

      logger.info("⏳ Testing Redis connection...");

      // Wait for connection - be patient with retries (30 seconds for Upstash)
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          this.client!.removeAllListeners("ready");
          this.client!.removeAllListeners("error");
          reject(new Error("Redis connection timeout (30s) - Upstash may be unreachable"));
        }, 30000); // 30 seconds to allow multiple retries

        this.client!.once("ready", () => {
          clearTimeout(timeout);
          this.client!.removeAllListeners("error");
          logger.info("   ✓ Redis connection established successfully");
          resolve(undefined);
        });

        // Don't reject on first error - let retry strategy handle it
        // Only log errors, don't fail immediately
        const errorCount = { count: 0 };
        this.client!.on("error", (err) => {
          errorCount.count++;
          // Only reject if we get many errors in a row during initial connection
          if (errorCount.count > 10) {
            clearTimeout(timeout);
            this.client!.removeAllListeners("ready");
            this.client!.removeAllListeners("error");
            reject(err);
          }
        });
      });

      this.isConnected = true;

      logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      logger.info("✅ REDIS CONNECTED SUCCESSFULLY!");
      logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      logger.info("   → Session storage: Available");
      logger.info("   → Caching: Available");
      logger.info("   → Rate limiting: Available");
      logger.info("   → Pub/Sub: Available");

      // Handle errors
      this.client.on("error", (err) => {
        logger.error(err, "Redis client error");
      });

      this.subscriber.on("error", (err) => {
        logger.error(err, "Redis subscriber error");
      });
    } catch (error) {
      this.isConnected = false;
      logger.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      logger.error("❌ REDIS CONNECTION FAILED!");
      logger.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      logger.error(error, "Connection error details");
      logger.warn("   → Continuing without Redis");
      logger.warn("   → Session storage will use alternative method");
      logger.warn("   → This is OK for single-server deployments");
      throw error;
    }
  }

  /**
   * Set a session with TTL (time to live)
   * @param sessionId Session identifier
   * @param data Session data (will be JSON stringified)
   * @param ttl Time to live in seconds (default: 24 hours)
   */
  async setSession(sessionId: string, data: any, ttl: number = 86400): Promise<void> {
    if (!this.client || !this.isConnected) {
      logger.warn("Redis not connected, skipping setSession");
      return;
    }

    try {
      const key = `sessions:${sessionId}`;
      await this.client.setex(key, ttl, JSON.stringify(data));
    } catch (error) {
      logger.error({ error, sessionId }, "Failed to set session in Redis");
      throw error;
    }
  }

  /**
   * Get a session by ID
   */
  async getSession(sessionId: string): Promise<any | null> {
    if (!this.client || !this.isConnected) {
      logger.warn("Redis not connected, returning null for getSession");
      return null;
    }

    try {
      const key = `sessions:${sessionId}`;
      const data = await this.client.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      logger.error({ error, sessionId }, "Failed to get session from Redis");
      return null;
    }
  }

  /**
   * Delete a session
   */
  async deleteSession(sessionId: string): Promise<void> {
    if (!this.client || !this.isConnected) {
      logger.warn("Redis not connected, skipping deleteSession");
      return;
    }

    try {
      const key = `sessions:${sessionId}`;
      await this.client.del(key);
    } catch (error) {
      logger.error({ error, sessionId }, "Failed to delete session from Redis");
    }
  }

  /**
   * Cache room metadata
   * @param roomId Room identifier
   * @param metadata Room metadata
   * @param ttl Time to live in seconds (default: 1 hour)
   */
  async cacheRoomMetadata(roomId: string, metadata: any, ttl: number = 3600): Promise<void> {
    if (!this.client || !this.isConnected) {
      return;
    }

    try {
      const key = `room:meta:${roomId}`;
      await this.client.setex(key, ttl, JSON.stringify(metadata));
    } catch (error) {
      logger.error({ error, roomId }, "Failed to cache room metadata");
    }
  }

  /**
   * Get cached room metadata
   */
  async getRoomMetadata(roomId: string): Promise<any | null> {
    if (!this.client || !this.isConnected) {
      return null;
    }

    try {
      const key = `room:meta:${roomId}`;
      const data = await this.client.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      logger.error({ error, roomId }, "Failed to get room metadata from cache");
      return null;
    }
  }

  /**
   * Publish a message to a channel (for multi-server communication)
   */
  async publish(channel: string, message: any): Promise<void> {
    if (!this.client || !this.isConnected) {
      return;
    }

    try {
      await this.client.publish(channel, JSON.stringify(message));
    } catch (error) {
      logger.error({ error, channel }, "Failed to publish message");
    }
  }

  /**
   * Subscribe to a channel and handle messages
   */
  async subscribe(channel: string, handler: (message: any) => void): Promise<void> {
    if (!this.subscriber || !this.isConnected) {
      logger.warn("Redis not connected, cannot subscribe");
      return;
    }

    try {
      await this.subscriber.subscribe(channel);

      this.subscriber.on("message", (ch, msg) => {
        if (ch === channel) {
          try {
            const parsedMessage = JSON.parse(msg);
            handler(parsedMessage);
          } catch (error) {
            logger.error({ error, channel, msg }, "Failed to parse subscribed message");
          }
        }
      });

      logger.info({ channel }, "Subscribed to Redis channel");
    } catch (error) {
      logger.error({ error, channel }, "Failed to subscribe to channel");
    }
  }

  /**
   * Rate limiting check using Redis
   * @param key Rate limit key (e.g., "create:userId")
   * @param limit Maximum number of requests
   * @param window Time window in seconds
   * @returns true if within limit, false if exceeded
   */
  async checkRateLimit(key: string, limit: number, window: number): Promise<boolean> {
    if (!this.client || !this.isConnected) {
      // If Redis is not available, allow the request (fail open)
      return true;
    }

    try {
      const fullKey = `rate:${key}`;
      const current = await this.client.incr(fullKey);

      if (current === 1) {
        // First request, set expiration
        await this.client.expire(fullKey, window);
      }

      return current <= limit;
    } catch (error) {
      logger.error({ error, key }, "Failed to check rate limit");
      // Fail open - allow the request if Redis errors
      return true;
    }
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    if (!config.redis.enabled) {
      return true; // Redis is disabled, so it's "healthy" by default
    }

    if (!this.client || !this.isConnected) {
      return false;
    }

    try {
      const result = await this.client.ping();
      return result === "PONG";
    } catch (error) {
      logger.error(error, "Redis health check failed");
      return false;
    }
  }

  /**
   * Close Redis connections
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      try {
        await this.client.quit();
        this.isConnected = false;
        logger.info("Redis client disconnected");
      } catch (error) {
        logger.error(error, "Error disconnecting Redis client");
      }
    }

    if (this.subscriber) {
      try {
        await this.subscriber.quit();
        logger.info("Redis subscriber disconnected");
      } catch (error) {
        logger.error(error, "Error disconnecting Redis subscriber");
      }
    }
  }

  /**
   * Get connection status
   */
  get connected(): boolean {
    return this.isConnected;
  }

  /**
   * Get Redis client (for direct access)
   * Use with caution - prefer service methods when possible
   * Returns null if not connected (safe for optional features)
   */
  getClient(): Redis | null {
    if (!this.client || !this.isConnected) {
      return null;
    }
    return this.client;
  }

  /**
   * Get the dedicated subscriber connection for pub/sub.
   * A separate connection is required because once a client is in subscriber
   * mode it can no longer issue regular commands.
   * Returns null if Redis isn't connected.
   */
  getSubscriber(): Redis | null {
    if (!this.subscriber || !this.isConnected) {
      return null;
    }
    return this.subscriber;
  }
}

// Export singleton instance
export const redisService = new RedisService();
