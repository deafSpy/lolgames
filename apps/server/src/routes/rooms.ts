import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Server } from "@colyseus/core";
import { matchMaker } from "@colyseus/core";
import { slugService } from "../services/slugService.js";
import { logger } from "../logger.js";

interface SlugParams {
  slug: string;
}

/**
 * Room routes for human-readable room codes.
 *
 * `gameServer` is accepted but currently unused — the matchmaker is a
 * module-level singleton in Colyseus 0.16 (`matchMaker.query`) rather than a
 * property on `Server`. We keep the parameter to mirror `registerAuthRoutes`
 * and friends in case future room-routes need direct server access.
 */
export async function registerRoomRoutes(app: FastifyInstance, _gameServer: Server) {
  /**
   * GET /api/rooms/slug/:slug
   * Look up room by human-readable slug
   * Returns room details if found (and active)
   */
  app.get(
    "/api/rooms/slug/:slug",
    async (request: FastifyRequest<{ Params: SlugParams }>, reply: FastifyReply) => {
      const { slug } = request.params;

      // Validate slug format
      if (!slugService.isValidSlug(slug)) {
        return reply.status(400).send({
          error: "invalid_slug",
          message: "Slug must be in format: adjective-color-noun",
        });
      }

      try {
        // Find room by querying all active rooms.
        // matchMaker is a module-level export in @colyseus/core; the Server
        // instance does not expose it as a property.
        const rooms = await matchMaker.query({});

        // Look for room with matching slug in metadata
        const room = rooms.find((r) => r.metadata?.roomSlug === slug);

        if (!room) {
          return reply.status(404).send({
            error: "room_not_found",
            message: `No active room found with slug: ${slug}`,
          });
        }

        // Return room info (sanitized for frontend)
        return {
          roomId: room.roomId,
          roomSlug: slug,
          name: room.name,
          clients: room.clients,
          maxClients: room.maxClients,
          locked: room.locked,
          private: room.private,
          metadata: room.metadata,
        };
      } catch (error) {
        logger.error({ error, slug }, "Failed to lookup room by slug");
        return reply.status(500).send({
          error: "lookup_failed",
          message: "Failed to lookup room",
        });
      }
    }
  );
}
