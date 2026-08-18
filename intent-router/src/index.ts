import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildPipeline } from "./bootstrap.js";
import { loadRouterBundle } from "./config.js";
import { errorMessage } from "./errors.js";
import { createIntentRouterServer } from "./server.js";

function configPathFromArgs(args: string[]): string {
  const index = args.indexOf("--config");
  const configuredPath = args[index + 1];
  if (index >= 0 && configuredPath) return resolve(configuredPath);
  return resolve(
    process.env.INTENT_ROUTER_CONFIG ?? "../config/intent-router.example.yaml",
  );
}

export async function run(): Promise<void> {
  const bundle = await loadRouterBundle(configPathFromArgs(process.argv.slice(2)));
  const pipeline = await buildPipeline(bundle);
  const server = createIntentRouterServer(bundle, pipeline);
  server.listen(bundle.config.server.port, bundle.config.server.bind, () => {
    console.log(
      JSON.stringify({
        event: "intent_router_started",
        bind: bundle.config.server.bind,
        port: bundle.config.server.port,
        dry_run: bundle.config.resolution.dry_run,
      }),
    );
  });

  const shutdown = () => server.close(() => process.exit(0));
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error(
      JSON.stringify({ event: "intent_router_failed", message: errorMessage(error) }),
    );
    process.exitCode = 1;
  });
}
