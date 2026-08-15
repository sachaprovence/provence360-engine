import { closeAdminPool, runMigrations } from "../admin/index";
import { loadDotEnv } from "../load-env";

loadDotEnv();

runMigrations()
  .then(() => console.log("Migrations complete."))
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void closeAdminPool();
  });
