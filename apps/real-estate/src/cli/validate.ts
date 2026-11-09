import { loadProspectsDetailed } from "@pm/core";

import { parseArgs } from "./util";

export async function validateCli(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  if (!args.prospects) {
    throw new Error("Usage: restate validate --prospects=/path/file.csv");
  }
  const result = loadProspectsDetailed(args.prospects);
  process.stdout.write(`${JSON.stringify(result.summary, null, 2)}\n`);
}
