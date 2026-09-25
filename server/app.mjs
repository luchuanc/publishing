import { createServer } from "node:http";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serveFile } from "./static.mjs";
import { HttpError } from "./service.mjs";

const digest = (value) => createHash("sha256").update(value).digest();
const hash = (value) => digest(value).toString("hex");
const json = (res, status, data) => {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
};
async function body(req) {
  if (!req.headers["content-type"]?.startsWith("application/json"))
    throw new HttpError(415, "请求必须使用 JSON");
  let value = "";
  for await (const chunk of req) {
    value += chunk;
    if (Buffer.byteLength(value) > 16 * 1024)
      throw new HttpError(413, "请求过大");
  }
  try {
    const data = JSON.parse(value || "{}");
    if (!data || Array.isArray(data) || typeof data !== "object")
      throw new Error();
    return data;
  } catch {
    throw new HttpError(400, "无效的 JSON 请求");
  }
}

export function createApp(service, config) {
  const db = service.db;
  const failures = new Map();
  const passwordDigest = digest(config.password);
  db.prepare("DELETE FROM sessions").run();
  const uiRoot = fileURLToPath(new URL("../dist", import.meta.url));
  const cookieName = config.secure
    ? "__Secure-publishing_session"
    : "publishing_session";
  const sessionCookie = (value, maxAge) =>
    `${cookieName}=${value}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${config.secure ? "; Secure" : ""}`;
  const token = (req) =>
    (req.headers.cookie || "")
      .split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith(cookieName + "="))
      ?.slice(cookieName.length + 1) || "";
  const authenticated = (req) =>
    !!db
      .prepare("SELECT hash FROM sessions WHERE hash=? AND expiresAt>?")
      .get(hash(token(req)), Date.now());
  return createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    try {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname === "/healthz" && req.method === "GET")
        return json(res, 200, { ok: true });
      if (!url.pathname.startsWith("/api/")) {
        if (await serveFile(req, res, uiRoot, url.pathname, { spa: true }))
          return;
        return json(res, 404, { error: "页面不存在，请先运行 npm run build" });
      }
      if (!["GET", "HEAD"].includes(req.method)) {
        if (
          req.headers["x-publishing-request"] !== "1" ||
          (req.headers.origin && req.headers.origin !== config.publicUrl)
        )
          throw new HttpError(403, "请求来源校验失败，请从配置的管理地址访问");
      }
      if (url.pathname === "/api/session" && req.method === "GET")
        return json(res, 200, { authenticated: authenticated(req) });
      if (url.pathname === "/api/login" && req.method === "POST") {
        const ip = req.socket.remoteAddress || "unknown";
        const failed = failures.get(ip);
        if (failed && failed.until > Date.now() && failed.count >= 10)
          throw new HttpError(429, "登录尝试过多，请 15 分钟后再试");
        const input = await body(req);
        if (
          typeof input.password !== "string" ||
          !timingSafeEqual(digest(input.password), passwordDigest)
        ) {
          if (failures.size > 1000)
            for (const [key, value] of failures)
              if (value.until < Date.now()) failures.delete(key);
          failures.set(ip, {
            count: failed?.until > Date.now() ? failed.count + 1 : 1,
            until:
              failed?.until > Date.now() ? failed.until : Date.now() + 900000,
          });
          throw new HttpError(401, "密码不正确");
        }
        failures.delete(ip);
        const value = randomBytes(32).toString("hex");
        db.prepare("DELETE FROM sessions WHERE expiresAt<?").run(Date.now());
        db.prepare("INSERT INTO sessions(hash,expiresAt) VALUES(?,?)").run(
          hash(value),
          Date.now() + 43200000,
        );
        res.setHeader("Set-Cookie", sessionCookie(value, 43200));
        return json(res, 200, { authenticated: true });
      }
      if (!authenticated(req)) throw new HttpError(401, "请先登录");
      if (url.pathname === "/api/logout" && req.method === "POST") {
        db.prepare("DELETE FROM sessions WHERE hash=?").run(hash(token(req)));
        res.setHeader("Set-Cookie", sessionCookie("", 0));
        return json(res, 200, { ok: true });
      }
      if (url.pathname === "/api/state" && req.method === "GET")
        return json(res, 200, service.snapshot());
      if (url.pathname === "/api/projects" && req.method === "POST")
        return json(res, 201, await service.addProject(await body(req)));
      let match =
        /^\/api\/projects\/([a-zA-Z0-9-]+)(?:\/(builds|rollback|publish|archive))?$/.exec(
          url.pathname,
        );
      if (match) {
        const [, id, action] = match;
        if (!action && req.method === "PATCH")
          return json(
            res,
            200,
            await service.updateProject(id, await body(req)),
          );
        if (req.method === "POST") {
          const input = await body(req);
          if (action === "builds")
            return json(
              res,
              202,
              service.enqueue(id, input.autoPublish !== false),
            );
          if (action === "rollback")
            return json(
              res,
              200,
              await service.rollback(id, input.expectedCurrent),
            );
          if (action === "publish")
            return json(
              res,
              200,
              await service.publish(
                id,
                String(input.releaseId),
                "published",
                input.expectedCurrent,
              ),
            );
          if (action === "archive") {
            await service.archiveProject(id, input.archived !== false);
            return json(res, 200, { ok: true });
          }
        }
      }
      match = /^\/api\/builds\/([0-9a-f-]{36})\/(log|cancel)$/.exec(
        url.pathname,
      );
      if (match) {
        const [, id, action] = match;
        service.build(id);
        if (action === "cancel" && req.method === "POST") {
          service.cancel(id);
          return json(res, 200, { ok: true });
        }
        if (action === "log" && req.method === "GET") {
          let text = "";
          try {
            text = await readFile(
              path.join(config.dataDir, "logs", `${id}.log`),
              "utf8",
            );
          } catch (error) {
            if (error.code !== "ENOENT") throw error;
          }
          return json(res, 200, { text });
        }
      }
      throw new HttpError(404, "接口不存在");
    } catch (error) {
      if (res.headersSent) return res.destroy();
      if (!error.status) console.error("请求失败：", error.message);
      json(res, error.status || 500, {
        error: error.status
          ? error.message
          : "操作失败，请检查服务日志或构建配置",
      });
    }
  });
}
