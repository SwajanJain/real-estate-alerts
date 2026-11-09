import fs from "node:fs";
import path from "node:path";

export interface StateStorePaths {
  root: string;
  raw: string;
  normalized: string;
  recent: string;
  lookups: string;
  cursors: string;
  runs: string;
  logs: string;
  locks: string;
}

export class StateStore {
  readonly paths: StateStorePaths;

  constructor(root: string) {
    this.paths = {
      root,
      raw: path.join(root, "raw"),
      normalized: path.join(root, "normalized"),
      recent: path.join(root, "recent"),
      lookups: path.join(root, "lookups"),
      cursors: path.join(root, "cursors"),
      runs: path.join(root, "runs"),
      logs: path.join(root, "logs"),
      locks: path.join(root, "locks"),
    };
  }

  ensure(): void {
    for (const dir of Object.values(this.paths)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  join(...parts: string[]): string {
    return path.join(this.paths.root, ...parts);
  }

  writeJson(filePath: string, value: unknown): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  }

  readJson<T>(filePath: string): T | null {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  }

  acquireLock(lockName: string): string {
    const lockPath = path.join(this.paths.locks, `${lockName}.lock`);
    try {
      const fd = fs.openSync(lockPath, "wx");
      fs.writeSync(fd, `${process.pid}\n`);
      fs.closeSync(fd);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") {
        const content = fs.readFileSync(lockPath, "utf8").trim();
        const lockPid = Number(content);
        const stat = fs.statSync(lockPath);
        const ageMinutes = Math.round((Date.now() - stat.mtimeMs) / 60_000);

        let processAlive = false;
        if (lockPid > 0) {
          try { process.kill(lockPid, 0); processAlive = true; } catch { /* process gone */ }
        }

        if (processAlive) {
          throw new Error(
            `Lock "${lockName}" is held by PID ${lockPid} (${ageMinutes} min old). ` +
            `That process is still running. If this is wrong, delete ${lockPath}`,
          );
        }

        process.stderr.write(
          `[WARN] Removing stale lock from dead PID ${lockPid || "unknown"} (${ageMinutes} min old): ${lockPath}\n`,
        );
        fs.unlinkSync(lockPath);
        const fd = fs.openSync(lockPath, "wx");
        fs.writeSync(fd, `${process.pid}\n`);
        fs.closeSync(fd);
      } else {
        throw err;
      }
    }
    return lockPath;
  }

  releaseLock(lockPath: string): void {
    if (fs.existsSync(lockPath)) {
      fs.unlinkSync(lockPath);
    }
  }
}
