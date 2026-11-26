import { httpRouter } from "convex/server";
import { authComponent, createAuth } from "./auth";

/**
 * HTTP routes on the Convex site URL.
 * - Better Auth routes are registered here (ADR-003).
 * - POST /telegram/webhook arrives in P1 (F-103, RB-5).
 * - GET /public/helpline arrives in P1 (D-R3 — the number is fetched only
 *   when tapped and is never in the app bundle).
 */
const http = httpRouter();

authComponent.registerRoutes(http, createAuth);

export default http;
