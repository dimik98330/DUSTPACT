import { database, migrate } from "./db-v3.ts";
import { configV3 } from "./v3-config.ts";
import { createV3Api } from "./v3-api.ts";
import { log } from "./security.ts";
const cfg = configV3(),
  db = database(cfg.databaseUrl);
await migrate(db);
const api = createV3Api(db, cfg);
api.server.listen(cfg.port, cfg.host, () =>
  log("v3_api_listening", {
    host: cfg.host,
    port: cfg.port,
    cluster: cfg.cluster,
  }),
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void api.close().finally(() => db.end());
  });
