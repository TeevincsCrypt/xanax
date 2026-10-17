/**
 * Seed the demo merchant locally: `pnpm seed`.
 * On a deployed instance use the admin endpoint instead:
 *   curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" $BASE_URL/admin/seed
 */
import { seedDemo } from "../src/seed.js";

const result = await seedDemo();
console.log(JSON.stringify(result, null, 2));
if (result.created) console.log("\nSave dashboard_url and webhook_secret now; they are not shown again.");
