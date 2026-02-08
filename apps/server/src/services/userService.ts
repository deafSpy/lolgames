import { database } from "./database.js";
import { GameType } from "@multiplayer/shared";
import { logger } from "../logger.js";

export interface User {
  id: string;
  username?: string;
  email?: string;
  display_name: string;
  is_anonymous: boolean;
  avatar_url?: string;
  password_hash?: string;
  auth_provider: string;
  google_id?: string;
  browser_session_id?: string;
  created_at: Date;
  updated_at: Date;
}

export interface PlayerStats {
  id: string;
  user_id: string;
  game_type: GameType;
  elo: number;
  wins: number;
  losses: number;
  draws: number;
  total_games: number;
  updated_at: Date;
}

class UserService {
  /**
   * Get or create a guest user by browser session ID
   */
  async getOrCreateGuest(browserSessionId: string, displayName: string): Promise<User> {
    try {
      // Try to find existing guest user
      let user = await database.queryOne<User>(
        `
        SELECT * FROM users 
        WHERE browser_session_id = $1 AND is_anonymous = true
        LIMIT 1
      `,
        [browserSessionId]
      );

      if (!user) {
        // Generate a unique username for the guest (e.g., "guest7382")
        const guestNumber = Math.floor(1000 + Math.random() * 9000);
        const username = `guest${guestNumber}`;

        // Create new guest user
        user = await database.queryOne<User>(
          `
          INSERT INTO users (username, display_name, is_anonymous, browser_session_id, auth_provider)
          VALUES ($1, $2, true, $3, 'guest')
          RETURNING *
        `,
          [username, displayName, browserSessionId]
        );

        logger.info(
          { userId: user!.id, browserSessionId, displayName, username },
          "Created new guest user"
        );
      }

      return user!;
    } catch (error) {
      logger.error({ error, browserSessionId }, "Failed to get or create guest user");
      throw error;
    }
  }

  /**
   * Get or create an authenticated user (via Google OAuth or email)
   */
  async getOrCreateUser(
    email: string,
    displayName: string,
    provider: string,
    googleId?: string,
    avatarUrl?: string
  ): Promise<User> {
    try {
      // Try to find existing user by email or google_id
      let user = await database.queryOne<User>(
        `
        SELECT * FROM users 
        WHERE email = $1 OR (google_id = $2 AND google_id IS NOT NULL)
        LIMIT 1
      `,
        [email.toLowerCase(), googleId || null]
      );

      if (!user) {
        // Generate username from email (part before @) or display name
        const emailUsername = email.split("@")[0];
        // Sanitize username: only alphanumeric and underscore, max 50 chars
        let username = emailUsername
          .toLowerCase()
          .replace(/[^a-z0-9_]/g, "")
          .substring(0, 50);

        // If username is empty or too short, use a generated one
        if (username.length < 3) {
          const randomNum = Math.floor(1000 + Math.random() * 9000);
          username = `user${randomNum}`;
        }

        // Create new authenticated user
        user = await database.queryOne<User>(
          `
          INSERT INTO users (username, email, display_name, is_anonymous, auth_provider, google_id, avatar_url)
          VALUES ($1, $2, $3, false, $4, $5, $6)
          RETURNING *
        `,
          [
            username,
            email.toLowerCase(),
            displayName,
            provider,
            googleId || null,
            avatarUrl || null,
          ]
        );

        logger.info(
          { userId: user!.id, email, provider, username },
          "Created new authenticated user"
        );
      } else {
        // Update existing user if needed (e.g., they signed in with Google after email, or avatar changed)
        const needsUpdate =
          (!user.google_id && googleId) || (avatarUrl && user.avatar_url !== avatarUrl);
        if (needsUpdate) {
          user = await database.queryOne<User>(
            `
            UPDATE users 
            SET google_id = COALESCE($1, google_id),
                auth_provider = $2,
                avatar_url = COALESCE($3, avatar_url),
                updated_at = NOW()
            WHERE id = $4
            RETURNING *
          `,
            [googleId || null, provider, avatarUrl || null, user.id]
          );
        }
      }

      return user!;
    } catch (error) {
      logger.error({ error, email }, "Failed to get or create authenticated user");
      throw error;
    }
  }

  /**
   * Get user by email
   */
  async getUserByEmail(email: string): Promise<User | null> {
    try {
      return await database.queryOne<User>(
        `
        SELECT * FROM users WHERE email = $1 LIMIT 1
      `,
        [email.toLowerCase()]
      );
    } catch (error) {
      logger.error({ error, email }, "Failed to get user by email");
      throw error;
    }
  }

  /**
   * Get user by ID
   */
  async getUserById(userId: string): Promise<User | null> {
    try {
      // Validate UUID format to prevent PostgreSQL errors
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(userId)) {
        logger.warn({ userId }, "Invalid UUID format for getUserById");
        return null;
      }

      return await database.queryOne<User>(
        `
        SELECT * FROM users WHERE id = $1 LIMIT 1
      `,
        [userId]
      );
    } catch (error) {
      logger.error({ error, userId }, "Failed to get user by ID");
      return null; // Return null instead of throwing to prevent crashes
    }
  }

  /**
   * Create a new user with password hash
   */
  async createUser(data: {
    email: string;
    displayName: string;
    passwordHash: string;
    provider: string;
  }): Promise<User> {
    try {
      const user = await database.queryOne<User>(
        `
        INSERT INTO users (email, display_name, password_hash, is_anonymous, auth_provider)
        VALUES ($1, $2, $3, false, $4)
        RETURNING *
      `,
        [data.email.toLowerCase(), data.displayName, data.passwordHash, data.provider]
      );

      logger.info({ userId: user!.id, email: data.email }, "Created new user with password");
      return user!;
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error), email: data.email },
        "Failed to create user"
      );
      throw error;
    }
  }

  /**
   * Update user profile
   */
  async updateUser(userId: string, updates: Partial<User>): Promise<User> {
    try {
      const allowedFields = ["username", "display_name", "avatar_url", "password_hash"];
      const fields = Object.keys(updates).filter((k) => allowedFields.includes(k));

      if (fields.length === 0) {
        throw new Error("No valid fields to update");
      }

      const setClause = fields.map((field, idx) => `${field} = $${idx + 2}`).join(", ");
      const values = fields.map((field) => (updates as any)[field]);

      const user = await database.queryOne<User>(
        `
        UPDATE users 
        SET ${setClause}, updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `,
        [userId, ...values]
      );

      logger.info({ userId, fields }, "Updated user profile");
      return user!;
    } catch (error) {
      logger.error({ error, userId }, "Failed to update user");
      throw error;
    }
  }

  /**
   * Get player stats for a specific game type
   */
  async getPlayerStats(userId: string, gameType: GameType): Promise<PlayerStats> {
    try {
      // Validate UUID format to prevent PostgreSQL errors
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(userId)) {
        logger.warn(
          { userId, gameType },
          "Invalid UUID format for getPlayerStats, returning default stats"
        );
        // Return default stats for invalid userId
        return {
          id: "temp",
          user_id: userId,
          game_type: gameType,
          elo: 1000,
          wins: 0,
          losses: 0,
          draws: 0,
          total_games: 0,
          updated_at: new Date(),
        };
      }

      let stats = await database.queryOne<PlayerStats>(
        `
        SELECT * FROM player_stats 
        WHERE user_id = $1 AND game_type = $2
        LIMIT 1
      `,
        [userId, gameType]
      );

      if (!stats) {
        // Create initial stats entry
        stats = await database.queryOne<PlayerStats>(
          `
          INSERT INTO player_stats (user_id, game_type, elo, wins, losses, draws, total_games)
          VALUES ($1, $2, 1000, 0, 0, 0, 0)
          RETURNING *
        `,
          [userId, gameType]
        );
      }

      return stats!;
    } catch (error) {
      logger.error({ error, userId, gameType }, "Failed to get player stats");
      throw error;
    }
  }

  /**
   * Get all player stats for a user (across all game types)
   */
  async getAllPlayerStats(userId: string): Promise<PlayerStats[]> {
    try {
      return await database.query<PlayerStats>(
        `
        SELECT * FROM player_stats 
        WHERE user_id = $1
        ORDER BY total_games DESC
      `,
        [userId]
      );
    } catch (error) {
      logger.error({ error, userId }, "Failed to get all player stats");
      throw error;
    }
  }

  /**
   * Update player stats after a game
   */
  async updatePlayerStats(
    userId: string,
    gameType: GameType,
    result: "win" | "loss" | "draw"
  ): Promise<void> {
    try {
      // Get current stats
      const stats = await this.getPlayerStats(userId, gameType);

      // Calculate ELO change (simplified - real ELO requires opponent's ELO)
      let eloChange = 0;
      if (result === "win") {
        eloChange = 25;
      } else if (result === "loss") {
        eloChange = -20;
      } else {
        eloChange = 0; // draw
      }

      const newElo = Math.max(0, stats.elo + eloChange);

      // Update stats
      await database.query(
        `
        UPDATE player_stats
        SET 
          elo = $1,
          wins = wins + $2,
          losses = losses + $3,
          draws = draws + $4,
          total_games = total_games + 1,
          updated_at = NOW()
        WHERE user_id = $5 AND game_type = $6
      `,
        [
          newElo,
          result === "win" ? 1 : 0,
          result === "loss" ? 1 : 0,
          result === "draw" ? 1 : 0,
          userId,
          gameType,
        ]
      );

      logger.info(
        {
          userId,
          gameType,
          result,
          oldElo: stats.elo,
          newElo,
          eloChange,
        },
        "Updated player stats"
      );
    } catch (error) {
      logger.error({ error, userId, gameType, result }, "Failed to update player stats");
      throw error;
    }
  }

  /**
   * Get leaderboard for a game type
   */
  async getLeaderboard(
    gameType: GameType,
    limit: number = 100
  ): Promise<
    Array<{
      user_id: string;
      display_name: string;
      elo: number;
      wins: number;
      losses: number;
      draws: number;
      total_games: number;
    }>
  > {
    try {
      return await database.query(
        `
        SELECT 
          u.id as user_id,
          u.display_name,
          ps.elo,
          ps.wins,
          ps.losses,
          ps.draws,
          ps.total_games
        FROM player_stats ps
        JOIN users u ON ps.user_id = u.id
        WHERE ps.game_type = $1 AND ps.total_games >= 5
        ORDER BY ps.elo DESC
        LIMIT $2
      `,
        [gameType, limit]
      );
    } catch (error) {
      logger.error({ error, gameType }, "Failed to get leaderboard");
      throw error;
    }
  }
}

export const userService = new UserService();
