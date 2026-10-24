import { serve } from "@hono/node-server";
import { loadConfig } from "./config";
import { connectMongo } from "./db/client";
import { firebaseVerifier } from "./auth/firebase";
import { disabledStorage, r2Storage } from "./lib/storage";
import { logMailer, resendMailer } from "./lib/mailer";
import { createApp } from "./app";

const config = loadConfig();
const { client, cols } = await connectMongo(config.mongoUri, config.dbName);

const app = createApp({
  config,
  client,
  cols,
  verifier: firebaseVerifier({ projectId: config.firebaseProjectId, serviceAccountJson: config.firebaseServiceAccountJson }),
  storage: config.r2 ? r2Storage(config.r2) : disabledStorage,
  mailer: config.resendApiKey ? resendMailer(config.resendApiKey, config.emailFrom) : logMailer,
});

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`EasyTenant API ${config.version} listening on :${info.port}`);
});

// Cloud Run sends SIGTERM before stopping an instance.
async function shutdown() {
  server.close();
  await client.close();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
