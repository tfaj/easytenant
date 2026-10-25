// Bundles the API (and the shared package) into dist/ as plain ESM.
// Runtime dependencies stay external and are installed in the image.
import { build } from "esbuild";

await build({
  entryPoints: ["src/server.ts", "src/scripts/migrate.ts", "src/scripts/bootstrap-admin.ts"],
  outdir: "dist",
  outbase: "src",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  packages: "external",
  // The workspace package is TypeScript source, so it must be bundled in.
  alias: { "@easytenant/shared": "../../packages/shared/src/index.ts" },
  logLevel: "info",
});
