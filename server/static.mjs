import { createReadStream } from "node:fs";
import { stat, realpath } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";

const mime = {
  ".apk": "application/vnd.android.package-archive",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".ogg": "audio/ogg",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
  ".fnt": "text/plain; charset=utf-8",
};

export async function serveFile(
  req,
  res,
  root,
  pathname,
  { spa = false, releaseId, urlPrefix = "" } = {},
) {
  if (!["GET", "HEAD"].includes(req.method)) {
    res.writeHead(405).end();
    return true;
  }
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400).end();
    return true;
  }
  if (
    decoded.includes("\0") ||
    decoded.includes("\\") ||
    decoded.split("/").some((p) => p.startsWith(".") && p !== "")
  ) {
    res.writeHead(404).end();
    return true;
  }
  const base = path.resolve(root);
  let file = path.resolve(
    base,
    `.${decoded.endsWith("/") ? `${decoded}index.html` : decoded}`,
  );
  if (!file.startsWith(base + path.sep)) {
    res.writeHead(404).end();
    return true;
  }
  let info;
  try {
    info = await stat(file);
    if (info.isDirectory()) {
      res
        .writeHead(308, {
          Location: urlPrefix + pathname.replace(/\/$/, "") + "/",
          "Cache-Control": "no-store",
        })
        .end();
      return true;
    }
  } catch {
    if (!spa || path.extname(decoded)) return false;
    file = path.join(base, "index.html");
    try {
      info = await stat(file);
    } catch {
      return false;
    }
  }
  const actual = await realpath(file);
  if (!actual.startsWith((await realpath(base)) + path.sep) || !info.isFile()) {
    res.writeHead(404).end();
    return true;
  }
  const ext = path.extname(file).toLowerCase();
  const etag = `"${releaseId || "ui"}-${info.size}-${Math.floor(info.mtimeMs)}"`;
  const headers = {
    "Content-Type": mime[ext] || "application/octet-stream",
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff",
    ETag: etag,
    "Accept-Ranges": "bytes",
  };
  if (releaseId) headers["X-Release-Id"] = releaseId;
  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304, headers).end();
    return true;
  }
  let start = 0,
    end = info.size - 1,
    status = 200;
  if (req.headers.range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (!match || (!match[1] && !match[2])) {
      res.writeHead(416, { "Content-Range": `bytes */${info.size}` }).end();
      return true;
    }
    start = match[1]
      ? Number(match[1])
      : Math.max(0, info.size - Number(match[2]));
    end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
    if (start > end || start >= info.size) {
      res.writeHead(416, { "Content-Range": `bytes */${info.size}` }).end();
      return true;
    }
    status = 206;
    headers["Content-Range"] = `bytes ${start}-${end}/${info.size}`;
  }
  headers["Content-Length"] = Math.max(0, end - start + 1);
  res.writeHead(status, headers);
  if (req.method === "HEAD" || !info.size) res.end();
  else {
    try {
      await pipeline(createReadStream(file, { start, end }), res);
    } catch {
      res.destroy();
    }
  }
  return true;
}
