// tests/ts-resolve.mjs — extensionless imports for `node --test`.
//
// The app code uses bundler-style imports ("./context", "@/lib/prisma")
// because that is what Next resolves. Node's ESM loader does not, so
// tests would otherwise force `.ts` suffixes into application source
// purely to satisfy the test runner. This hook closes that gap instead.
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";

register("./tests/ts-resolve-hooks.mjs", pathToFileURL("./"));
export { existsSync };
