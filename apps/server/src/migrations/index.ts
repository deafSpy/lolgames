import { database } from "../services/database.js";
import { logger } from "../logger.js";

/**
 * Database migrations that run automatically on server startup
 * Safe to run multiple times - uses CREATE IF NOT EXISTS and checks existing schema
 */
export async function runMigrations(): Promise<void> {
  try {
    logger.info("Starting database migrations...");

    // Check if database is connected
    if (!database.connected) {
      logger.warn("Database is not connected, skipping migrations");
      return;
    }

    // Step 1: Enable UUID extension
    await database.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    logger.info("✓ UUID extension enabled");

    // Step 2: Check and create game_type enum
    const enumExists = await database.queryOne<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'game_type'
      ) as exists
    `);

    if (!enumExists?.exists) {
      // Create enum with all game types
      await database.query(`
        CREATE TYPE game_type AS ENUM (
          'connect4', 
          'rps', 
          'quoridor', 
          'sequence', 
          'catan', 
          'splendor', 
          'monopoly_deal', 
          'blackjack'
        )
      `);
      logger.info("✓ Created game_type enum");
    } else {
      // Check if enum needs to be updated with new game types
      const existingValues = await database.query<{ enumlabel: string }>(`
        SELECT enumlabel 
        FROM pg_enum 
        JOIN pg_type ON pg_enum.enumtypid = pg_type.oid 
        WHERE pg_type.typname = 'game_type'
      `);

      const currentValues = new Set(existingValues.map((row) => row.enumlabel));
      const requiredValues = [
        "connect4",
        "rps",
        "quoridor",
        "sequence",
        "catan",
        "splendor",
        "monopoly_deal",
        "blackjack",
      ];

      // Add missing enum values
      for (const value of requiredValues) {
        if (!currentValues.has(value)) {
          await database.query(`ALTER TYPE game_type ADD VALUE IF NOT EXISTS '${value}'`);
          logger.info(`✓ Added '${value}' to game_type enum`);
        }
      }
    }

    // Step 3: Create users table
    await database.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        username VARCHAR(50) UNIQUE,
        email VARCHAR(255) UNIQUE,
        display_name VARCHAR(100) NOT NULL,
        is_anonymous BOOLEAN DEFAULT true,
        avatar_url TEXT,
        password_hash TEXT,
        auth_provider VARCHAR(50) DEFAULT 'password',
        google_id VARCHAR(255) UNIQUE,
        browser_session_id VARCHAR(100),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);
    logger.info("✓ Users table ready");

    // Step 4: Create indexes on users table
    await database.query(`
      CREATE INDEX IF NOT EXISTS idx_users_anonymous ON users(is_anonymous)
    `);
    await database.query(`
      CREATE INDEX IF NOT EXISTS idx_users_browser_session ON users(browser_session_id)
    `);
    await database.query(`
      CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id)
    `);
    logger.info("✓ User indexes ready");

    // Step 5: Create player_stats table
    await database.query(`
      CREATE TABLE IF NOT EXISTS player_stats (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        game_type game_type NOT NULL,
        elo INTEGER DEFAULT 1000,
        wins INTEGER DEFAULT 0,
        losses INTEGER DEFAULT 0,
        draws INTEGER DEFAULT 0,
        total_games INTEGER DEFAULT 0,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(user_id, game_type)
      )
    `);
    logger.info("✓ Player stats table ready");

    // Step 6: Create index on player_stats for leaderboards
    await database.query(`
      CREATE INDEX IF NOT EXISTS idx_stats_elo ON player_stats(game_type, elo DESC)
    `);
    logger.info("✓ Player stats indexes ready");

    // Step 7: Create matches table
    await database.query(`
      CREATE TABLE IF NOT EXISTS matches (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        game_type game_type NOT NULL,
        room_id VARCHAR(50) NOT NULL,
        winner_id UUID REFERENCES users(id),
        is_draw BOOLEAN DEFAULT false,
        vs_bot BOOLEAN DEFAULT false,
        duration_ms INTEGER,
        total_moves INTEGER,
        started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        ended_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);
    logger.info("✓ Matches table ready");

    // Step 8: Create indexes on matches table
    await database.query(`
      CREATE INDEX IF NOT EXISTS idx_matches_game_type ON matches(game_type)
    `);
    await database.query(`
      CREATE INDEX IF NOT EXISTS idx_matches_ended_at ON matches(ended_at DESC)
    `);
    await database.query(`
      CREATE INDEX IF NOT EXISTS idx_matches_room_id ON matches(room_id)
    `);
    logger.info("✓ Match indexes ready");

    // Step 9: Create match_participants table
    await database.query(`
      CREATE TABLE IF NOT EXISTS match_participants (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        team_id INTEGER,
        result VARCHAR(20),
        elo_before INTEGER,
        elo_after INTEGER,
        elo_change INTEGER,
        score INTEGER DEFAULT 0,
        UNIQUE(match_id, user_id)
      )
    `);
    logger.info("✓ Match participants table ready");

    // Step 10: Create index on match_participants
    await database.query(`
      CREATE INDEX IF NOT EXISTS idx_participants_user ON match_participants(user_id)
    `);
    await database.query(`
      CREATE INDEX IF NOT EXISTS idx_participants_match ON match_participants(match_id)
    `);
    logger.info("✓ Match participants indexes ready");

    // Step 11: Create match_replays table (for future replay feature)
    await database.query(`
      CREATE TABLE IF NOT EXISTS match_replays (
        match_id UUID PRIMARY KEY REFERENCES matches(id) ON DELETE CASCADE,
        moves JSONB NOT NULL,
        initial_state JSONB,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);
    logger.info("✓ Match replays table ready");

    // Step 12: Create or replace update_updated_at function
    await database.query(`
      CREATE OR REPLACE FUNCTION update_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    logger.info("✓ Update timestamp function ready");

    // Step 13: Create triggers for updated_at
    await database.query(`
      DROP TRIGGER IF EXISTS users_updated_at ON users
    `);
    await database.query(`
      CREATE TRIGGER users_updated_at
        BEFORE UPDATE ON users
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at()
    `);

    await database.query(`
      DROP TRIGGER IF EXISTS stats_updated_at ON player_stats
    `);
    await database.query(`
      CREATE TRIGGER stats_updated_at
        BEFORE UPDATE ON player_stats
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at()
    `);
    logger.info("✓ Triggers ready");

    // Step 14: Create merge_guest_to_user function
    await database.query(`
      CREATE OR REPLACE FUNCTION merge_guest_to_user(
        p_guest_id UUID,
        p_user_id UUID
      )
      RETURNS VOID AS $$
      DECLARE
        r_stats RECORD;
      BEGIN
        -- 1. Move all Match History
        -- Update match_participants to point to the new user_id
        -- Skip if it would create a duplicate (same match, same user)
        UPDATE match_participants
        SET user_id = p_user_id
        WHERE user_id = p_guest_id
        AND NOT EXISTS (
          SELECT 1 FROM match_participants mp2 
          WHERE mp2.match_id = match_participants.match_id 
          AND mp2.user_id = p_user_id
        );

        -- 2. Merge Player Stats
        FOR r_stats IN SELECT * FROM player_stats WHERE user_id = p_guest_id
        LOOP
          -- Check if the target user already has stats for this game type
          IF EXISTS (SELECT 1 FROM player_stats WHERE user_id = p_user_id AND game_type = r_stats.game_type) THEN
            -- CONFLICT: Merge the stats
            UPDATE player_stats
            SET 
              wins = wins + r_stats.wins,
              losses = losses + r_stats.losses,
              draws = draws + r_stats.draws,
              total_games = total_games + r_stats.total_games,
              -- Keep the highest ELO
              elo = GREATEST(elo, r_stats.elo),
              updated_at = NOW()
            WHERE user_id = p_user_id AND game_type = r_stats.game_type;

            -- Delete the guest stats since we merged them
            DELETE FROM player_stats WHERE id = r_stats.id;
          ELSE
            -- NO CONFLICT: Transfer ownership
            UPDATE player_stats
            SET user_id = p_user_id, updated_at = NOW()
            WHERE id = r_stats.id;
          END IF;
        END LOOP;

        -- 3. Update matches table to point winner_id to new user
        UPDATE matches
        SET winner_id = p_user_id
        WHERE winner_id = p_guest_id;

        -- 4. (Optional) Mark guest as merged or delete
        -- For audit trail, we'll keep the guest record but mark it
        UPDATE users
        SET 
          display_name = display_name || ' [MERGED]',
          updated_at = NOW()
        WHERE id = p_guest_id;

      END;
      $$ LANGUAGE plpgsql
    `);
    logger.info("✓ Guest-to-user merge function ready");

    // Step 15: Add deleted_at column for soft deletes
    await database.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE
    `);
    logger.info("✓ Soft delete column added");

    // Step 16: Add participants_snapshot column to matches
    await database.query(`
      ALTER TABLE matches
      ADD COLUMN IF NOT EXISTS participants_snapshot JSONB
    `);
    logger.info("✓ Participants snapshot column added");

    // Step 17: Add room_slug column for human-readable room codes
    await database.query(`
      ALTER TABLE matches
      ADD COLUMN IF NOT EXISTS room_slug VARCHAR(255)
    `);
    // Create a regular index on room_slug (not partial, to avoid IMMUTABLE function requirement)
    // Slugs will naturally be unique due to collision detection in slugService
    await database.query(`
      CREATE INDEX IF NOT EXISTS idx_matches_room_slug
      ON matches(room_slug)
      WHERE room_slug IS NOT NULL
    `);
    logger.info("✓ Room slug column and index added");

    // Step 18: match_events — disconnect/reconnect/reconnect_expired log used by
    // the reconnect contract (DEA-19). Independent of matches so we can log
    // events for rooms that never finish (a forfeit happens before the
    // matches row is written).
    await database.query(`
      CREATE TABLE IF NOT EXISTS match_events (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        room_id VARCHAR(50) NOT NULL,
        room_slug VARCHAR(255),
        game_type game_type NOT NULL,
        event_type VARCHAR(32) NOT NULL,
        session_id VARCHAR(64) NOT NULL,
        user_id UUID REFERENCES users(id),
        browser_session_id VARCHAR(100),
        display_name VARCHAR(100),
        metadata JSONB,
        event_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )
    `);
    await database.query(`
      CREATE INDEX IF NOT EXISTS idx_match_events_room ON match_events(room_id, event_at)
    `);
    await database.query(`
      CREATE INDEX IF NOT EXISTS idx_match_events_session ON match_events(session_id, event_at)
    `);
    await database.query(`
      CREATE INDEX IF NOT EXISTS idx_match_events_type_at ON match_events(event_type, event_at)
    `);
    logger.info("✓ match_events table ready");

    // Step 19: match_event_outbox — durable outbox for recordGame writes (DEA-37).
    // recordGame writes a single outbox row inside its DB tx; the background
    // outboxFlusher drains undelivered rows into matches/match_participants. This
    // closes the crash window between Colyseus closing a finished game and the
    // matches row being committed. The outbox row's id IS the future matches.id,
    // which gives us cheap idempotency via ON CONFLICT (id) DO NOTHING.
    await database.query(`
      CREATE TABLE IF NOT EXISTS match_event_outbox (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        match_id TEXT NOT NULL,
        payload_json JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        delivered_at TIMESTAMPTZ NULL,
        attempt_count INT NOT NULL DEFAULT 0,
        last_error TEXT NULL,
        next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    // Partial index on undelivered rows keeps the flusher tick O(undelivered).
    await database.query(`
      CREATE INDEX IF NOT EXISTS idx_outbox_undelivered
      ON match_event_outbox (next_attempt_at)
      WHERE delivered_at IS NULL
    `);
    await database.query(`
      CREATE INDEX IF NOT EXISTS idx_outbox_created_at
      ON match_event_outbox (created_at)
      WHERE delivered_at IS NULL
    `);
    logger.info("✓ match_event_outbox table ready");

    // Step 20: Add max_players column to matches (DEA-14-P1-B).
    // Additive + DEFAULT 2 so existing rows backfill correctly (Connect 4 was the
    // only persisted game type before this change). Required before Phase 2
    // multi-player games (Sequence, Splendor, Quoridor 4p, Monopoly Deal) so
    // a slug-routed share URL can render seat counts from history.
    await database.query(`
      ALTER TABLE matches
      ADD COLUMN IF NOT EXISTS max_players INT NOT NULL DEFAULT 2
    `);
    logger.info("✓ matches.max_players column added");

    logger.info("✅ Database migrations completed successfully");
  } catch (error) {
    logger.error(error, "❌ Database migration failed");
    throw error;
  }
}
