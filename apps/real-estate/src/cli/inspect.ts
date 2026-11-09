import fs from "node:fs";
import path from "node:path";

import { StateStore } from "@pm/core";

import { CacheStore } from "../fetchers/cache-store";
import { parseArgs } from "./util";

function resolveStateDir(cwd: string, override?: string): string {
  return override || process.env.RESTATE_STATE_DIR || path.join(cwd, ".restate");
}

export async function inspectCli(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const stateStore = new StateStore(resolveStateDir(process.cwd(), args["state-dir"]));
  stateStore.ensure();
  const cacheStore = new CacheStore(stateStore);

  if (args.property) {
    const prior = cacheStore.readPriorState(args.property);
    process.stdout.write(`${JSON.stringify(prior, null, 2)}\n`);
    return;
  }

  if (args.fips && args.start && args.end && args.page) {
    const pagePath = cacheStore.pagePath(args.fips, args.start, args.end, Number(args.page));
    if (!fs.existsSync(pagePath)) throw new Error(`Cached page not found: ${pagePath}`);
    process.stdout.write(fs.readFileSync(pagePath, "utf8"));
    return;
  }

  throw new Error("Usage: restate inspect --property=<attomId> OR --fips=11001 --start=YYYY/MM/DD --end=YYYY/MM/DD --page=1");
}
