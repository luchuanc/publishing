import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { finished } from "node:stream/promises";

// A small allowlist prevents the management password and session configuration
// from being inherited by package scripts. Repositories must still be trusted.
export function buildEnvironment() {
  const env = {
    CI: "true",
    NODE_ENV: "production",
    // Build tools are devDependencies, but Vite must still emit production code.
    npm_config_include: "dev",
    GIT_TERMINAL_PROMPT: "0",
    GIT_SSH_COMMAND:
      "ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=15",
    npm_config_audit: "false",
    npm_config_fund: "false",
  };
  for (const key of [
    "PATH",
    "HOME",
    "TMPDIR",
    "SSH_AUTH_SOCK",
    "LANG",
    "LC_ALL",
    "HTTPS_PROXY",
    "HTTP_PROXY",
    "NO_PROXY",
  ]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return env;
}

export function buildLog(file) {
  const stream = createWriteStream(file, { flags: "a", mode: 0o600 });
  let size = 0,
    failure;
  stream.on("error", (error) => {
    failure = error;
  });
  return {
    write(value) {
      if (failure || size > 4 * 1024 * 1024) return;
      const message = String(value).replace(/\x1b\[[0-9;]*m/g, "");
      size += Buffer.byteLength(message);
      stream.write(
        size > 4 * 1024 * 1024
          ? "\n[日志超过 4 MB，后续输出已截断]\n"
          : message,
      );
    },
    async close() {
      stream.end();
      await finished(stream);
      if (failure) throw failure;
    },
  };
}

export function command(
  binary,
  args,
  { cwd, log, signal, timeoutMs, env = buildEnvironment() },
) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("构建已取消"));
    log.write(`\n$ ${[binary, ...args].join(" ")}\n`);
    const child = spawn(binary, args, {
      cwd,
      env,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let reason, forceTimer;
    const kill = (sig) => {
      try {
        process.kill(
          process.platform === "win32" ? child.pid : -child.pid,
          sig,
        );
      } catch {}
    };
    const stop = (message) => {
      if (reason) return;
      reason = message;
      kill("SIGTERM");
      forceTimer = setTimeout(() => kill("SIGKILL"), 1500);
    };
    const abort = () => stop("构建已取消");
    const timer = setTimeout(() => stop("构建超时"), timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk) => log.write(chunk));
    child.stderr.on("data", (chunk) => log.write(chunk));
    const cleanup = () => {
      clearTimeout(timer);
      clearTimeout(forceTimer);
      signal?.removeEventListener("abort", abort);
    };
    child.on("error", (error) => {
      cleanup();
      reject(error);
    });
    child.on("close", (code) => {
      cleanup();
      reason
        ? reject(new Error(reason))
        : code === 0
          ? resolve()
          : reject(new Error(`命令退出码 ${code}`));
    });
  });
}
