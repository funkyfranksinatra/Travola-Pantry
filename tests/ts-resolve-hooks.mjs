import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";

const ROOT = process.cwd();

export async function resolve(specifier, context, nextResolve) {
  // "@/lib/x" -> "<root>/lib/x"
  let spec = specifier;
  if (spec.startsWith("@/")) {
    spec = pathToFileURL(resolvePath(ROOT, spec.slice(2))).href;
  }
  if (spec.startsWith(".") || spec.startsWith("file:")) {
    const base = spec.startsWith("file:")
      ? fileURLToPath(spec)
      : resolvePath(dirname(fileURLToPath(context.parentURL)), spec);
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}.js`, `${base}/index.js`]) {
      if (existsSync(candidate) && !candidate.endsWith("/")) {
        try {
          return await nextResolve(pathToFileURL(candidate).href, context);
        } catch {
          /* keep looking */
        }
      }
    }
  }
  try {
    return await nextResolve(spec, context);
  } catch (error) {
    // Bare package subpaths that Next publishes with an extension
    // ("next/server" -> "next/server.js"). The bundler resolves these;
    // Node's ESM loader does not.
    if (!spec.startsWith(".") && !spec.startsWith("file:") && !spec.endsWith(".js")) {
      return nextResolve(`${spec}.js`, context);
    }
    throw error;
  }
}
