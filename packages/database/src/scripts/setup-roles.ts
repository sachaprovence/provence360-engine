import { closeAdminPool, setupRoles } from "../admin/index";
import { loadDotEnv } from "../load-env";

loadDotEnv();

setupRoles()
  .then(() => console.log("Role setup complete."))
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void closeAdminPool();
  });
