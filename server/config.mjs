import path from "node:path";

export function configuration(env = process.env) {
  const port = Number(env.PORT || 8080);
  const publicUrl = env.PUBLIC_URL || `http://127.0.0.1:${port}`;
  const url = new URL(publicUrl);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("PUBLIC_URL 必须是完整站点地址，不含路径");
  const host = env.GAME_PUBLIC_HOST || url.hostname;
  if (!/^[a-zA-Z0-9.\-]+$/.test(host))
    throw new Error("GAME_PUBLIC_HOST 必须是 IPv4 地址或域名");
  const password = env.ADMIN_PASSWORD || "";
  if (password.length < 12)
    throw new Error(
      "请先运行 npm run setup，或配置至少 12 位的 ADMIN_PASSWORD",
    );
  const publicPort = Number(env.PUBLIC_PORT || 8200);
  if (
    ![port, publicPort].every(
      (n) => Number.isInteger(n) && n >= 1024 && n <= 65535,
    ) ||
    port === publicPort
  )
    throw new Error("后台与公开资源端口配置无效或重叠");
  const timeout = Number(env.BUILD_TIMEOUT_MINUTES || 20);
  if (!Number.isFinite(timeout) || timeout < 1 || timeout > 180)
    throw new Error("构建超时应在 1–180 分钟之间");
  return {
    port,
    host: env.HOST || "0.0.0.0",
    publicUrl: url.origin,
    gameHost: host,
    password,
    dataDir: path.resolve(env.DATA_DIR || ".data"),
    publicPort,
    timeoutMs: timeout * 60000,
    secure: env.COOKIE_SECURE === "true" || url.protocol === "https:",
    seed: env.SEED_PROJECTS !== "false",
  };
}
