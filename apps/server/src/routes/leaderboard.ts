import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { userService } from "../services/userService.js";
import { GameType } from "@multiplayer/shared";
import { logger } from "../logger.js";

interface LeaderboardParams {
  gameType: string;
}

interface LeaderboardQuerystring {
  limit?: string;
}

export async function registerLeaderboardRoutes(app: FastifyInstance) {
  /**
   * Get leaderboard for a specific game type
   * GET /leaderboard/:gameType?limit=100
   */
  app.get(
    "/leaderboard/:gameType",
    async (
      request: FastifyRequest<{ Params: LeaderboardParams; Querystring: LeaderboardQuerystring }>,
      reply: FastifyReply
    ) => {
      try {
        const { gameType } = request.params;
        const limit = parseInt(request.query.limit || "100", 10);

        // Validate game type
        const validGameTypes = Object.values(GameType);
        if (!validGameTypes.includes(gameType as GameType)) {
          return reply.status(400).send({
            error: "invalid_game_type",
            message: `Game type must be one of: ${validGameTypes.join(", ")}`,
          });
        }

        // Validate limit
        if (limit < 1 || limit > 500) {
          return reply.status(400).send({
            error: "invalid_limit",
            message: "Limit must be between 1 and 500",
          });
        }

        // Get leaderboard from database
        const leaderboard = await userService.getLeaderboard(gameType as GameType, limit);

        return {
          gameType,
          limit,
          players: leaderboard,
        };
      } catch (error) {
        logger.error({ error, gameType: request.params.gameType }, "Failed to get leaderboard");
        return reply.status(500).send({
          error: "internal_error",
          message: "Failed to fetch leaderboard",
        });
      }
    }
  );

  /**
   * Get all leaderboards (top 10 for each game type)
   * GET /leaderboard
   */
  app.get("/leaderboard", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const gameTypes = Object.values(GameType);
      const leaderboards: Record<string, any[]> = {};

      // Fetch leaderboard for each game type
      for (const gameType of gameTypes) {
        leaderboards[gameType] = await userService.getLeaderboard(gameType, 10);
      }

      return {
        leaderboards,
      };
    } catch (error) {
      logger.error({ error }, "Failed to get all leaderboards");
      return reply.status(500).send({
        error: "internal_error",
        message: "Failed to fetch leaderboards",
      });
    }
  });
}
