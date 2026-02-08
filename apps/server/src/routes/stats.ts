import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { JWT } from "@colyseus/auth";
import { userService } from "../services/userService.js";
import { logger } from "../logger.js";

interface StatsQuerystring {
  userId?: string;
}

export async function registerStatsRoutes(app: FastifyInstance) {
  /**
   * Get player stats for the authenticated user or a specific user
   * GET /stats?userId=xxx
   */
  app.get(
    "/stats",
    async (request: FastifyRequest<{ Querystring: StatsQuerystring }>, reply: FastifyReply) => {
      try {
        let userId: string | null = null;

        // Try to get userId from query parameter
        if (request.query.userId) {
          userId = request.query.userId;
        } else {
          // Try to get userId from JWT token
          const authHeader = request.headers.authorization;
          if (authHeader?.startsWith("Bearer ")) {
            const token = authHeader.substring("Bearer ".length);
            try {
              const payload = JWT.verify(token) as { id?: string };
              userId = payload.id || null;
            } catch {
              // Invalid token, continue without userId
            }
          }
        }

        if (!userId) {
          return reply.status(400).send({
            error: "user_required",
            message: "User ID is required (provide ?userId=xxx or authorization header)",
          });
        }

        // Get user info
        const user = await userService.getUserById(userId);
        if (!user) {
          return reply.status(404).send({
            error: "user_not_found",
            message: "User not found",
          });
        }

        // Get all player stats for this user
        const stats = await userService.getAllPlayerStats(userId);

        return {
          user: {
            id: user.id,
            displayName: user.display_name,
            isAnonymous: user.is_anonymous,
          },
          stats,
        };
      } catch (error) {
        logger.error({ error, userId: request.query.userId }, "Failed to get player stats");
        return reply.status(500).send({
          error: "internal_error",
          message: "Failed to fetch player stats",
        });
      }
    }
  );
}
