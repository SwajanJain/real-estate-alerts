import fs from "node:fs";
import path from "node:path";

export function parseArgs(argv: string[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const token of argv) {
    const match = token.match(/^--([^=]+)=(.*)$/);
    if (match) values[match[1]] = match[2];
  }
  return values;
}

export function readEnvFile(cwd: string): Record<string, string> {
  const envPath = path.join(cwd, ".env");
  try {
    const content = fs.readFileSync(envPath, "utf8");
    const result: Record<string, string> = {};
    for (const line of content.split(/\r?\n/)) {
      if (!line || line.startsWith("#") || !line.includes("=")) continue;
      const [key, ...rest] = line.split("=");
      result[key.trim()] = rest.join("=").trim();
    }
    return result;
  } catch {
    return {};
  }
}
