import { createServer } from "node:http";
import path from "node:path";
import { serveFile } from "./static.mjs";

export function createPublicServer(service) {
  return createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    try {
      const url = new URL(req.url, "http://public.local");
      if (!["GET", "HEAD"].includes(req.method))
        return res.writeHead(405).end();
      if (url.pathname === "/api/catalog") {
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": "*",
        });
        return res.end(
          req.method === "HEAD" ? undefined : JSON.stringify(service.catalog()),
        );
      }
      const icon = /^\/icons\/([0-9a-f]{64}\.png)$/.exec(url.pathname);
      if (
        icon &&
        (await serveFile(
          req,
          res,
          path.join(service.config.dataDir, "icons"),
          "/" + icon[1],
        ))
      )
        return;
      const download =
        /^\/downloads\/([a-zA-Z0-9-]+)\/([0-9a-f-]{36}|latest)\/app\.apk$/.exec(
          url.pathname,
        );
      if (download) {
        const p = service.project(download[1]);
        if (p.archived || p.kind !== "android") return res.writeHead(404).end();
        const b = service.build(
          download[2] === "latest" ? p.currentReleaseId : download[2],
        );
        if (
          b.projectId !== p.id ||
          b.status !== "succeeded" ||
          JSON.parse(b.config).kind !== "android"
        )
          return res.writeHead(404).end();
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${p.id}-${b.id.slice(0, 8)}.apk"`,
        );
        if (
          await serveFile(req, res, service.releaseDir(b.id), "/app.apk", {
            releaseId: b.id,
          })
        )
          return;
      }
      const game = /^\/([a-zA-Z0-9-]+)(\/.*)?$/.exec(url.pathname);
      if (game && !["api", "icons", "downloads"].includes(game[1])) {
        const p = service.project(game[1]);
        if (p.kind !== "web") return res.writeHead(404).end();
        if (p.archived || !p.currentReleaseId)
          return res
            .writeHead(503, {
              "Content-Type": "text/plain; charset=utf-8",
              "Cache-Control": "no-store",
            })
            .end("游戏尚未发布");
        if (!game[2])
          return res
            .writeHead(308, {
              Location: `/${p.id}/${url.search}`,
              "Cache-Control": "no-store",
            })
            .end();
        const pathname = game[2];
        if (
          await serveFile(
            req,
            res,
            service.hostedDir(p.currentReleaseId),
            pathname,
            { releaseId: p.currentReleaseId, urlPrefix: `/${p.id}` },
          )
        )
          return;
        // Keep immutable chunks available to clients opened before a release or rollback.
        if (/[-.][a-zA-Z0-9_-]{8,}\.(js|css|woff2?)$/.test(pathname)) {
          for (const b of service.db
            .prepare(
              "SELECT id FROM builds WHERE projectId=? AND status='succeeded' ORDER BY createdAt DESC",
            )
            .all(p.id)) {
            if (
              b.id !== p.currentReleaseId &&
              (await serveFile(req, res, service.hostedDir(b.id), pathname, {
                releaseId: b.id,
                urlPrefix: `/${p.id}`,
              }))
            )
              return;
          }
        }
      }
      res.writeHead(404).end("Not found");
    } catch (error) {
      if (res.headersSent) return res.destroy();
      res.writeHead(error.status || 500).end("资源不可用");
    }
  });
}
