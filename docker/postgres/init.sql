-- Initial database schema for Multiplayer Games Platform
-- This runs automatically when the PostgreSQL container is first created

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(50) UNIQUE,
    email VARCHAR(255) UNIQUE,
    display_name VARCHAR(100) NOT NULL,
    is_anonymous BOOLEAN DEFAULT true,
    avatar_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for anonymous user lookup
CREATE INDEX IF NOT EXISTS idx_users_anonymous ON users(is_anonymous);

-- Game types enum
CREATE TYPE game_type AS ENUM ('connect4', 'rps', 'quoridor', 'sequence');

-- Player stats table (per game type)
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
);

-- Create index for leaderboard queries
CREATE INDEX IF NOT EXISTS idx_stats_elo ON player_stats(game_type, elo DESC);

-- Matches table
CREATE TABLE IF NOT EXISTS matches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    game_type game_type NOT NULL,
    room_id VARCHAR(50) NOT NULL,
    winner_id UUID REFERENCES users(id),
    is_draw BOOLEAN DEFAULT false,
    duration_seconds INTEGER,
    total_moves INTEGER,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    ended_at TIMESTAMP WITH TIME ZONE
);

-- Create index for match history queries
CREATE INDEX IF NOT EXISTS idx_matches_game_type ON matches(game_type);
CREATE INDEX IF NOT EXISTS idx_matches_ended_at ON matches(ended_at DESC);

-- Match participants table
CREATE TABLE IF NOT EXISTS match_participants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    team_id INTEGER,
    elo_before INTEGER,
    elo_after INTEGER,
    elo_change INTEGER,
    score INTEGER DEFAULT 0,
    UNIQUE(match_id, user_id)
);

-- Create index for user match history
CREATE INDEX IF NOT EXISTS idx_participants_user ON match_participants(user_id);

-- Match replay data (for future replay feature)
CREATE TABLE IF NOT EXISTS match_replays (
    match_id UUID PRIMARY KEY REFERENCES matches(id) ON DELETE CASCADE,
    moves JSONB NOT NULL,
    initial_state JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Function to update timestamps
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
CREATE TRIGGER users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER stats_updated_at
    BEFORE UPDATE ON player_stats
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- Insert a test anonymous user
INSERT INTO users (display_name, is_anonymous)
VALUES ('Guest_test', true)
ON CONFLICT DO NOTHING;

