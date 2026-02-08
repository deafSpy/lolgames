import { Pool, PoolClient } from "pg";
import { config } from "../config.js";
import { logger } from "../logger.js";

/**
 * Database service for PostgreSQL connection pooling and query execution
 * Supports both local Docker and Supabase PostgreSQL
 */
class DatabaseService {
  private pool: Pool | null = null;
  private isConnected = false;

  /**
   * Initialize database connection pool
   */
  async connect(): Promise<void> {
    logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    logger.info("🗄️  DATABASE CONNECTION ATTEMPT");
    logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    if (!config.database.enabled) {
      logger.warn("⚠️  DATABASE_ENABLED=false - Using in-memory storage");
      logger.warn("   → Games will NOT be saved to database");
      logger.warn("   → Data will be lost on server restart");
      return;
    }

    logger.info("✓ DATABASE_ENABLED=true");

    if (!config.database.url) {
      logger.error("❌ DATABASE_URL is missing!");
      throw new Error("DATABASE_URL is required when DATABASE_ENABLED=true");
    }

    // Log connection attempt (hide password)
    const urlForLogging = config.database.url.replace(/:[^:@]+@/, ":****@");
    logger.info(`📡 Attempting connection to: ${urlForLogging}`);

    try {
      // Determine if we're connecting to Supabase or local docker
      const isSupabase = config.database.url.includes("supabase.com");
      logger.info(`   Environment: ${isSupabase ? "Supabase Cloud" : "Local Docker"}`);
      logger.info(`   SSL: ${isSupabase ? "Enabled (required for Supabase)" : "Disabled (local)"}`);

      this.pool = new Pool({
        connectionString: config.database.url,
        // Supabase requires SSL, local docker doesn't
        ssl: isSupabase ? { rejectUnauthorized: false } : false,
        // Connection pool settings for Supabase session pooler
        max: 20, // Maximum pool size
        min: 2, // Minimum pool size
        idleTimeoutMillis: 30000, // Close idle connections after 30s
        connectionTimeoutMillis: 10000, // Timeout after 10s if can't connect
      });

      logger.info("⏳ Testing database connection...");

      // Test connection
      const client = await this.pool.connect();
      const result = await client.query("SELECT NOW() as now, version() as version");
      client.release();

      this.isConnected = true;

      logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      logger.info("✅ DATABASE CONNECTED SUCCESSFULLY!");
      logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      logger.info(
        {
          environment: isSupabase ? "Supabase" : "Local Docker",
          serverTime: result.rows[0].now,
          postgresVersion:
            result.rows[0].version.split(" ")[0] + " " + result.rows[0].version.split(" ")[1],
        },
        "Database info"
      );
      logger.info("   → Games WILL be saved to database");
      logger.info("   → User profiles WILL persist");
      logger.info("   → Match history WILL be stored");
    } catch (error) {
      this.isConnected = false;
      logger.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      logger.error("❌ DATABASE CONNECTION FAILED!");
      logger.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      logger.error(error, "Connection error details");
      logger.error("   → Falling back to IN-MEMORY storage");
      logger.error("   → Games will NOT persist after restart");
      logger.error("   → Check your DATABASE_URL in .env");
      throw error;
    }

    // Handle pool errors
    this.pool.on("error", (err) => {
      logger.error(err, "Unexpected database pool error");
    });
  }

  /**
   * Execute a query with parameterized values
   * @param sql SQL query string with $1, $2, etc. placeholders
   * @param params Array of parameter values
   * @returns Query result rows
   */
  async query<T = any>(sql: string, params?: any[]): Promise<T[]> {
    if (!this.pool || !this.isConnected) {
      throw new Error("Database is not connected. Call connect() first.");
    }

    try {
      const start = Date.now();
      const result = await this.pool.query(sql, params);
      const duration = Date.now() - start;

      // Log slow queries (> 100ms)
      if (duration > 100) {
        logger.warn(
          {
            sql: sql.substring(0, 100) + (sql.length > 100 ? "..." : ""),
            duration,
            rows: result.rowCount,
          },
          "Slow query detected"
        );
      }

      return result.rows as T[];
    } catch (error) {
      logger.error(
        {
          error,
          sql: sql.substring(0, 200),
          params,
        },
        "Database query failed"
      );
      throw error;
    }
  }

  /**
   * Execute a single query and return the first row (or null)
   */
  async queryOne<T = any>(sql: string, params?: any[]): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Execute multiple queries in a transaction
   * If the callback throws an error, the transaction is rolled back
   * @param callback Function that receives a database client and performs queries
   * @returns The result returned by the callback
   */
  async transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    if (!this.pool || !this.isConnected) {
      throw new Error("Database is not connected. Call connect() first.");
    }

    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const result = await callback(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      logger.error(error, "Transaction rolled back due to error");
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Check if database connection is healthy
   * @returns true if connected and can query
   */
  async healthCheck(): Promise<boolean> {
    if (!config.database.enabled) {
      return true; // Database is disabled, so it's "healthy" by default
    }

    if (!this.pool || !this.isConnected) {
      return false;
    }

    try {
      const result = await this.query("SELECT 1 as health");
      return result.length > 0 && result[0].health === 1;
    } catch (error) {
      logger.error(error, "Database health check failed");
      return false;
    }
  }

  /**
   * Close all database connections
   */
  async close(): Promise<void> {
    if (this.pool) {
      try {
        await this.pool.end();
        this.isConnected = false;
        logger.info("Database connections closed");
      } catch (error) {
        logger.error(error, "Error closing database connections");
        throw error;
      }
    }
  }

  /**
   * Get connection status
   */
  get connected(): boolean {
    return this.isConnected;
  }
}

// Export singleton instance
export const database = new DatabaseService();
