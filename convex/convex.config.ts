import { defineApp } from "convex/server";
import betterAuth from "@convex-dev/better-auth/convex.config";
import expoPushNotifications from "@convex-dev/expo-push-notifications/convex.config";
import rateLimiter from "@convex-dev/rate-limiter/convex.config";

// Components per ADR-002/003/008/017 (docs/ADRs.md).
const app = defineApp();
app.use(betterAuth);
app.use(expoPushNotifications);
app.use(rateLimiter);

export default app;
