import {
  cp,
  mkdir,
  readFile,
  writeFile,
  readdir,
  rm,
  access,
} from "node:fs/promises";
import path from "node:path";

// Preserve original artifacts, while making pre-subdirectory releases usable for rollback.
export async function prepareLegacyReleases(service) {
  service.legacyReleases = new Set();
  const root = path.join(service.config.dataDir, "subpath-releases");
  await mkdir(root, { recursive: true });
  for (const b of service.db
    .prepare(
      "SELECT * FROM builds WHERE status='succeeded' AND artifactsDeletedAt IS NULL AND artifactCleanupStartedAt IS NULL",
    )
    .all()) {
    const config = JSON.parse(b.config);
    if (
      config.hostingLayout ||
      !["zizou", "xiangsu", "backHome"].includes(b.projectId) ||
      config.kind === "android"
    )
      continue;
    const target = path.join(root, b.id),
      marker = path.join(target, ".converted-v2");
    try {
      await access(marker);
      service.legacyReleases.add(b.id);
      continue;
    } catch {}
    // An interrupted migration is safe to retry; immutable originals are never changed.
    await rm(target, { recursive: true, force: true });
    try {
      await access(path.join(service.releaseDir(b.id), "index.html"));
    } catch {
      continue;
    }
    await cp(service.releaseDir(b.id), target, { recursive: true });
    const prefix = "/" + b.projectId + "/";
    async function rewrite(dir) {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await rewrite(file);
          continue;
        }
        if (
          !entry.isFile() ||
          !/\.(html|js|css|json|webmanifest)$/.test(entry.name)
        )
          continue;
        let text = await readFile(file, "utf8");
        text = text.replace(
          /(["'`(])\/(assets\/|icon[.\-]|manifest\.webmanifest|favicon\.svg|sw\.js)/g,
          "$1" + prefix + "$2",
        );
        text = text.replace(
          /(return|=>)(\s*)(["'])\/\3\s*\+/g,
          '$1$2"' + prefix + '"+',
        );
        if (entry.name === "manifest.webmanifest")
          text = text.replace(
            /("(?:start_url|scope)"\s*:\s*")\/("?)/g,
            "$1" + prefix + "$2",
          );
        if (entry.name === "sw.js") {
          text = text.replace(/(["'])\/\1/g, JSON.stringify(prefix));
          text = text.replaceAll("shanhai-", `shanhai-${b.projectId}-`);
          text = text.replace(
            "new URL(event.request.url).origin!==self.location.origin",
            `new URL(event.request.url).origin!==self.location.origin||!new URL(event.request.url).pathname.startsWith(${JSON.stringify(prefix)})`,
          );
        }
        await writeFile(file, text);
      }
    }
    await rewrite(target);
    await writeFile(marker, "1");
    service.legacyReleases.add(b.id);
  }
}
