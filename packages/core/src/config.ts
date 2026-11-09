import fs from "node:fs";
import path from "node:path";

export interface AppConfig {
  stateDir: string;
  outputDir: string;
  fecApiKey: string;
  ftmApiKey: string;
  ldaApiKey: string;
  maxProspectSkipRate: number;
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  const values: Record<string, string> = {};
  for (const line of lines) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const [key, ...rest] = line.split("=");
    values[key.trim()] = rest.join("=").trim();
  }
  return values;
}

export function loadConfig(cwd: string, overrides: Partial<AppConfig> = {}): AppConfig {
  const envValues = parseEnvFile(path.join(cwd, ".env"));
  return {
    stateDir: overrides.stateDir || process.env.PFUND_STATE_DIR || envValues.PFUND_STATE_DIR || path.join(cwd, ".pfund"),
    outputDir: overrides.outputDir || path.join((overrides.stateDir || process.env.PFUND_STATE_DIR || envValues.PFUND_STATE_DIR || path.join(cwd, ".pfund")), "runs"),
    fecApiKey: overrides.fecApiKey || process.env.FEC_API_KEY || envValues.FEC_API_KEY || "",
    ftmApiKey: overrides.ftmApiKey || process.env.FTM_API_KEY || envValues.FTM_API_KEY || "",
    ldaApiKey: overrides.ldaApiKey || process.env.LDA_API_KEY || envValues.LDA_API_KEY || "",
    maxProspectSkipRate: overrides.maxProspectSkipRate ?? parseNumber(process.env.PFUND_MAX_PROSPECT_SKIP_RATE || envValues.PFUND_MAX_PROSPECT_SKIP_RATE, 0.05),
  };
}
