export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export function createLogger(verbose = true): Logger {
  const print = (level: string, message: string) => {
    if (!verbose && level === "INFO") return;
    process.stderr.write(`[${level}] ${message}\n`);
  };

  return {
    info: (message: string) => print("INFO", message),
    warn: (message: string) => print("WARN", message),
    error: (message: string) => print("ERROR", message),
  };
}
