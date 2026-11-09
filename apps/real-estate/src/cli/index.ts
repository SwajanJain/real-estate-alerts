#!/usr/bin/env node

import { bulkFetchCli } from "./bulk-fetch";
import { fetchCli } from "./fetch";
import { inspectCli } from "./inspect";
import { monitorCli } from "./monitor";
import { runCli } from "./run";
import { validateCli } from "./validate";

async function main(): Promise<void> {
  const [, , command, ...rest] = process.argv;

  switch (command) {
    case "monitor":
      await monitorCli(rest);
      return;
    case "bulk-fetch":
      await bulkFetchCli(rest);
      return;
    case "run":
      await runCli(rest);
      return;
    case "fetch":
      await fetchCli(rest);
      return;
    case "inspect":
      await inspectCli(rest);
      return;
    case "validate":
      await validateCli(rest);
      return;
    default:
      throw new Error("Usage: restate <monitor|bulk-fetch|run|fetch|inspect|validate> ...");
  }
}

main().catch((error) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
