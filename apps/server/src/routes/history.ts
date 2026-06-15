import { config as loadEnv } from "dotenv";

loadEnv();

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { JWT } from "@colyseus/auth";
import { historyService } from "../services/historyService.js";

interface HistoryQuerystring {
  browserSessionId?: string;
  cursor?: string;
  limit?: string;
}

export async function registerHistoryRoutes(app: FastifyInstance) {
  app.get(
    "/history",
    async (request: FastifyRequest<{ Querystring: HistoryQuerystring }>, reply: FastifyReply) => {
      const authHeader = request.headers.authorization;
      let userId: string | null = null;
      let browserSessionId: string | null = null;

      // Check for authenticated user
      if (authHeader?.startsWith("Bearer ")) {
        const token = authHeader.substring("Bearer ".length);
        try {
          // Decode JWT without verification first to see structure
          const decoded = JWT.decode(token) as any;
          console.log("🔍 History: JWT decoded (raw):", JSON.stringify(decoded, null, 2));

          // Extract user ID from decoded token
          userId = decoded?.id || decoded?.user?.id || null;

          console.log("🔍 History: Extracted userId from token:", userId);
        } catch (error) {
          console.warn(
            "🔍 History: JWT decode failed, continuing as guest:",
            error instanceof Error ? error.message : error
          );
          userId = null;
        }
      }

      // Always check for browserSessionId (for both authenticated and guest users)
      browserSessionId = request.query.browserSessionId || null;
      const cursor = request.query.cursor || undefined;
      const limit = request.query.limit ? parseInt(request.query.limit, 10) : 10;
      console.log("🔍 History: Request params", { userId, browserSessionId, cursor, limit });

      // Need at least one identifier
      if (!userId && !browserSessionId) {
        return reply.status(400).send({ error: "identity_required" });
      }

      // Pass both userId and browserSessionId to getRecentGames with cursor pagination
      const games = await historyService.getRecentGames(userId, browserSessionId, limit, cursor);

      // Return next cursor for pagination (the timestamp of the last game in this batch)
      const nextCursor =
        games.length > 0 ? new Date(games[games.length - 1].endedAt).toISOString() : null;

      return {
        userId,
        browserSessionId,
        games,
        nextCursor,
        hasMore: games.length === limit,
      };
    }
  );
}
