import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const publicDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../public");

export function readUiAsset(name: "index.html" | "styles.css" | "app.js"): string {
  return readFileSync(resolve(publicDirectory, name), "utf8");
}
