import { database, migrate } from "./db.ts";
import { configV2 } from "./v2-config.ts";
import { createV2Api } from "./v2-api.ts";
import { log } from "./security.ts";
const cfg = configV2(),
  db = database(cfg.databaseUrl);
await migrate(db);
const api = createV2Api(db, cfg);
api.server.listen(cfg.port, cfg.host, () =>
  log("v2_api_listening", {
    host: cfg.host,
    port: cfg.port,
    cluster: cfg.cluster,
  }),
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void api.close().finally(() => db.end());
  });
