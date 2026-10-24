import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { bodyLimit } from "hono/body-limit";
import type { AppEnv, Deps } from "./context";
import { Access } from "./access/access";
import { AppError } from "./lib/errors";
import me from "./routes/me";
import developments from "./routes/developments";
import units from "./routes/units";
import tenancies from "./routes/tenancies";
import invites from "./routes/invites";
import faults from "./routes/faults";
import users from "./routes/users";
import notifications from "./routes/notifications";
import uploads from "./routes/uploads";
import jobs from "./routes/jobs";

export function createApp(deps: Deps) {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    const start = performance.now();
    await next();
    if (c.req.path === "/api/health") return;
    // One JSON line per request; Cloud Logging parses these.
    console.log(
      JSON.stringify({
        severity: c.res.status >= 500 ? "ERROR" : "INFO",
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        ms: Math.round(performance.now() - start),
      })
    );
  });
  app.use("*", secureHeaders());
  app.use(
    "/api/*",
    cors({
      origin: (origin) => (deps.config.webOrigins.includes(origin) ? origin : null),
      allowHeaders: ["Authorization", "Content-Type"],
      allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
      maxAge: 86400,
    })
  );
  app.use("*", bodyLimit({ maxSize: 2 * 1024 * 1024 }));

  app.use("*", async (c, next) => {
    c.set("deps", deps);
    const header = c.req.header("Authorization");
    const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
    const user = token ? await deps.verifier.verify(token) : null;
    c.set("access", new Access(deps.cols, user));
    await next();
  });

  // ?deep=1 also pings MongoDB. Cloud Scheduler calls it every 10 minutes
  // so a Cloud Run instance and its Atlas connection pool stay warm.
  app.get("/api/health", async (c) => {
    if (c.req.query("deep") === "1") {
      const start = performance.now();
      await deps.client.db(deps.config.dbName).command({ ping: 1 });
      return c.json({ ok: true, version: deps.config.version, dbMs: Math.round(performance.now() - start) });
    }
    return c.json({ ok: true, version: deps.config.version });
  });
  app.get("/api/config", (c) =>
    c.json({
      faultOverdueDays: deps.config.faultOverdueDays,
      defaultCurrency: deps.config.defaultCurrency,
      uploadsEnabled: deps.storage.enabled,
    })
  );

  app.route("/api/me", me);
  app.route("/api/developments", developments);
  app.route("/api", units);
  app.route("/api", tenancies);
  app.route("/api", invites);
  app.route("/api/faults", faults);
  app.route("/api/users", users);
  app.route("/api/notifications", notifications);
  app.route("/api/uploads", uploads);
  app.route("/internal/jobs", jobs);

  app.notFound((c) => c.json({ error: { code: "not_found", message: "No such endpoint." } }, 404));

  app.onError((err, c) => {
    if (err instanceof AppError) {
      return c.json({ error: { code: err.code, message: err.message, details: err.details } }, err.status);
    }
    console.error(JSON.stringify({ severity: "ERROR", message: err.message, stack: err.stack, path: c.req.path }));
    return c.json({ error: { code: "internal", message: "Something went wrong on our side." } }, 500);
  });

  return app;
}
