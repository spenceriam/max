import { readFileSync, unlinkSync, writeFileSync } from "fs";

export interface DaemonInstanceLock {
  readonly lockPath: string;
  readonly pid: number;
  release(): void;
}

interface LockFileRecord {
  pid: number;
  startedAt: string;
}

export function acquireDaemonInstanceLock(lockPath: string): DaemonInstanceLock {
  const record: LockFileRecord = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(lockPath, JSON.stringify(record) + "\n", {
        flag: "wx",
        mode: 0o600,
      });

      let released = false;
      return {
        lockPath,
        pid: process.pid,
        release(): void {
          if (released) return;
          released = true;
          releaseDaemonInstanceLock(lockPath, process.pid);
        },
      };
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== "EEXIST") {
        throw error;
      }

      const existing = readLockFile(lockPath);
      if (!existing || !isProcessRunning(existing.pid)) {
        releaseDaemonInstanceLock(lockPath, existing?.pid);
        continue;
      }

      throw new Error(
        `Another Max daemon is already running (pid ${existing.pid}). Stop it first or use 'max tui' to connect.`
      );
    }
  }

  throw new Error(
    `Could not acquire the Max daemon lock at ${lockPath}. Please try again.`
  );
}

export function releaseDaemonInstanceLock(lockPath: string, pid?: number): void {
  try {
    if (pid !== undefined) {
      const existing = readLockFile(lockPath);
      if (existing && existing.pid !== pid) return;
    }

    unlinkSync(lockPath);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== "ENOENT") {
      throw error;
    }
  }
}

function readLockFile(lockPath: string): LockFileRecord | null {
  try {
    const raw = readFileSync(lockPath, "utf-8").trim();
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LockFileRecord>;
    if (!Number.isInteger(parsed.pid) || (parsed.pid ?? 0) <= 0) {
      return null;
    }
    return {
      pid: parsed.pid as number,
      startedAt: parsed.startedAt ?? "",
    };
  } catch {
    return null;
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "EPERM") return true;
    if (err.code === "ESRCH") return false;
    throw error;
  }
}
