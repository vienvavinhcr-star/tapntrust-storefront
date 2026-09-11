import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";

declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
      ADMIN_API_TOKEN: string;
    }
  }
}

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
