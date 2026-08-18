import { readFile } from "node:fs/promises";
import { buildHomeAssistantAppEnvironment } from "./app-options.js";
import { run } from "./index.js";

const APP_OPTIONS_PATH = "/data/options.json";

async function main(): Promise<void> {
  const options = JSON.parse(await readFile(APP_OPTIONS_PATH, "utf8")) as Record<
    string,
    unknown
  >;
  Object.assign(
    process.env,
    buildHomeAssistantAppEnvironment(
      options as unknown as Parameters<typeof buildHomeAssistantAppEnvironment>[0],
      process.env,
    ),
  );
  await run();
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ event: "intent_router_app_failed", message }));
  process.exitCode = 1;
});
