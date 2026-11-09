import path from "node:path";

import { StateStore } from "@pm/core";

import { AttomClient } from "../fetchers/attom";
import { CacheStore } from "../fetchers/cache-store";
import { parseArgs, readEnvFile } from "./util";

export async function fetchCli(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  if (!args.fips || !args.start || !args.end) {
    throw new Error("Usage: restate fetch --fips=11001 --start=YYYY/MM/DD --end=YYYY/MM/DD [--page=1]");
  }
  const cwd = process.cwd();
  const envValues = readEnvFile(cwd);
  const apiKeyRaw = process.env.ATTOM_API_KEY || envValues.ATTOM_API_KEY || "";
  const apiKeys = apiKeyRaw.split(",").map((k) => k.trim()).filter(Boolean);
  if (apiKeys.length === 0) throw new Error("Missing ATTOM_API_KEY in environment or .env");
  const root = args["state-dir"] || process.env.RESTATE_STATE_DIR || envValues.RESTATE_STATE_DIR || path.join(cwd, ".restate");
  const stateStore = new StateStore(root);
  stateStore.ensure();
  const client = new AttomClient({ apiKeys });
  const cacheStore = new CacheStore(stateStore);
  const page = Number(args.page || "1");
  const result = await client.fetchCountyPage({ fips: args.fips, startDate: args.start, endDate: args.end, page });
  cacheStore.writePage(args.fips, args.start, args.end, page, result);
  cacheStore.markPageComplete(args.fips, args.start, args.end, page, result.pages);
  process.stdout.write(`${cacheStore.pagePath(args.fips, args.start, args.end, page)}\n`);
}
