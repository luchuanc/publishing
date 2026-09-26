import { lstat, readdir, rm, statfs } from "node:fs/promises";
import path from "node:path";

const DAY = 86400000;
export const retentionPolicy = Object.freeze({
  logDays: 30,
  successfulBuilds: 10,
  graceDays: 7,
});
const identifier = /^[0-9a-f-]{36}$/;
const missing = (error) => {
  if (error.code !== "ENOENT") throw error;
  return null;
};

// Never traverse links when reporting usage or removing managed build files.
async function directorySize(file) {
  const info = await lstat(file).catch(missing);
  if (!info || info.isSymbolicLink()) return 0;
  if (info.isFile()) return info.size;
  if (!info.isDirectory()) return 0;
  let total = 0;
  for (const name of (await readdir(file).catch(missing)) || [])
    total += await directorySize(path.join(file, name));
  return total;
}

export class StorageManager {
  constructor(service) {
    this.service = service;
    this.db = service.db;
    this.root = service.config.dataDir;
    this.running = null;
    this.timer = null;
  }
  rows() {
    return this.db
      .prepare(
        "SELECT * FROM builds ORDER BY coalesce(finishedAt,createdAt) DESC,createdAt DESC,rowid DESC",
      )
      .all();
  }
  protectedIds(rows = this.rows()) {
    const ids = new Set();
    for (const p of this.db
      .prepare("SELECT currentReleaseId,previousReleaseId FROM projects")
      .all()) {
      if (p.currentReleaseId) ids.add(p.currentReleaseId);
      if (p.previousReleaseId) ids.add(p.previousReleaseId);
    }
    const counts = new Map();
    for (const b of rows) {
      if (
        ["queued", "running"].includes(b.status) ||
        b.id === this.service.active?.id
      )
        ids.add(b.id);
      if (
        b.status !== "succeeded" ||
        b.artifactsDeletedAt ||
        b.artifactCleanupStartedAt
      )
        continue;
      const count = (counts.get(b.projectId) || 0) + 1;
      counts.set(b.projectId, count);
      if (count <= retentionPolicy.successfulBuilds) ids.add(b.id);
    }
    return ids;
  }
  reconcile(at = Date.now()) {
    const rows = this.rows(),
      protectedIds = this.protectedIds(rows);
    const stamp = new Date(at).toISOString();
    for (const b of rows) {
      if (
        b.status !== "succeeded" ||
        b.artifactsDeletedAt ||
        b.artifactCleanupStartedAt
      )
        continue;
      if (protectedIds.has(b.id)) {
        if (b.cleanupEligibleAt)
          this.db
            .prepare("UPDATE builds SET cleanupEligibleAt=NULL WHERE id=?")
            .run(b.id);
      } else if (!b.cleanupEligibleAt) {
        this.db
          .prepare("UPDATE builds SET cleanupEligibleAt=? WHERE id=?")
          .run(stamp, b.id);
      }
    }
  }
  logExpired(b, at) {
    return (
      b &&
      !b.logDeletedAt &&
      !["queued", "running"].includes(b.status) &&
      b.id !== this.service.active?.id &&
      Date.parse(b.finishedAt || b.createdAt) <=
        at - retentionPolicy.logDays * DAY
    );
  }
  plan(at = Date.now()) {
    const rows = this.rows(),
      protectedIds = this.protectedIds(rows);
    const artifacts = [],
      logs = [];
    for (const b of rows) {
      if (!identifier.test(b.id)) continue;
      if (
        b.status === "succeeded" &&
        !b.artifactsDeletedAt &&
        !protectedIds.has(b.id)
      ) {
        const eligibleAt = b.cleanupEligibleAt || new Date(at).toISOString();
        const deleteAfter = new Date(
          Date.parse(eligibleAt) + retentionPolicy.graceDays * DAY,
        ).toISOString();
        artifacts.push({
          id: b.id,
          projectId: b.projectId,
          eligibleAt,
          deleteAfter,
          ready: !!b.artifactCleanupStartedAt || Date.parse(deleteAfter) <= at,
        });
      }
      if (this.logExpired(b, at)) {
        logs.push({ id: b.id, projectId: b.projectId });
      }
    }
    return { artifacts, logs, protectedIds };
  }
  async managedPath(folder, name) {
    const parent = path.join(this.root, folder);
    const parentInfo = await lstat(parent).catch(missing);
    if (!parentInfo) return null;
    if (parentInfo.isSymbolicLink() || !parentInfo.isDirectory())
      throw new Error(`${folder} 不是安全的托管目录，已跳过清理`);
    const target = path.join(parent, name);
    const info = await lstat(target).catch(missing);
    if (info?.isSymbolicLink())
      throw new Error(`${folder}/${name} 是符号链接，已跳过清理`);
    return info ? target : null;
  }
  async removeArtifactFiles(id) {
    // Check both parents before touching either; interrupted deletions stay tombstoned for retry.
    const locations = [];
    for (const folder of ["releases", "subpath-releases"]) {
      const target = await this.managedPath(folder, id);
      if (target) locations.push(target);
    }
    let bytes = 0;
    for (const target of locations) {
      bytes += await directorySize(target);
      await rm(target, { recursive: true, force: true });
    }
    return bytes;
  }
  async inspect(at = Date.now()) {
    const plan = this.plan(at);
    const totals = { artifacts: 0, logs: 0, work: 0, icons: 0, other: 0 };
    const projects = this.db
      .prepare("SELECT id,name FROM projects ORDER BY createdAt,id")
      .all()
      .map((p) => ({
        ...p,
        artifacts: 0,
        logs: 0,
        work: 0,
        retainedBuilds: 0,
      }));
    const projectMap = new Map(projects.map((p) => [p.id, p]));
    const builds = new Map(this.rows().map((b) => [b.id, b]));
    const artifactBytes = new Map(),
      logBytes = new Map();
    for (const entry of await readdir(this.root, { withFileTypes: true })) {
      const group = {
        releases: "artifacts",
        "subpath-releases": "artifacts",
        logs: "logs",
        work: "work",
        icons: "icons",
      }[entry.name];
      if (!group || !entry.isDirectory()) {
        totals.other += await directorySize(path.join(this.root, entry.name));
        continue;
      }
      for (const name of (await readdir(path.join(this.root, entry.name)).catch(
        missing,
      )) || []) {
        const bytes = await directorySize(
          path.join(this.root, entry.name, name),
        );
        totals[group] += bytes;
        const id = group === "logs" ? name.replace(/\.log$/, "") : name;
        const project = projectMap.get(builds.get(id)?.projectId);
        if (project && group !== "icons") project[group] += bytes;
        if (group === "artifacts")
          artifactBytes.set(id, (artifactBytes.get(id) || 0) + bytes);
        if (group === "logs") logBytes.set(id, bytes);
      }
    }
    for (const b of builds.values()) {
      if (
        b.status === "succeeded" &&
        !b.artifactsDeletedAt &&
        !b.artifactCleanupStartedAt
      ) {
        const project = projectMap.get(b.projectId);
        if (project) project.retainedBuilds++;
      }
    }
    const artifacts = plan.artifacts.map((b) => ({
      ...b,
      bytes: artifactBytes.get(b.id) || 0,
    }));
    const logs = plan.logs.map((b) => ({
      ...b,
      bytes: logBytes.get(b.id) || 0,
    }));
    const disk = await statfs(this.root);
    let lastRun = null;
    try {
      lastRun = JSON.parse(this.service.setting("storageLastRun") || "null");
    } catch {}
    return {
      policy: retentionPolicy,
      checkedAt: new Date(at).toISOString(),
      running: !!this.running,
      lastRun,
      disk: {
        totalBytes: disk.blocks * disk.bsize,
        availableBytes: disk.bavail * disk.bsize,
        usedBytes: (disk.blocks - disk.bfree) * disk.bsize,
      },
      usage: {
        ...totals,
        total: Object.values(totals).reduce((a, b) => a + b, 0),
      },
      projects,
      cleanup: {
        artifacts,
        logs,
        reclaimableBytes: [...artifacts.filter((b) => b.ready), ...logs].reduce(
          (sum, b) => sum + b.bytes,
          0,
        ),
      },
    };
  }
  cleanup(source = "manual", at = Date.now()) {
    if (this.running) return this.running;
    this.running = this.performCleanup(source, at).finally(() => {
      this.running = null;
    });
    return this.running;
  }
  async performCleanup(source, at) {
    const result = {
      source,
      startedAt: new Date(at).toISOString(),
      finishedAt: null,
      artifacts: 0,
      logs: 0,
      freedBytes: 0,
      errors: [],
    };
    try {
      this.reconcile(at);
      const plan = this.plan(at);
      for (const candidate of plan.artifacts.filter((b) => b.ready)) {
        try {
          await this.service.withArtifactLock(async () => {
            this.reconcile(at);
            if (
              !this.plan(at).artifacts.some(
                (b) => b.id === candidate.id && b.ready,
              )
            )
              return;
            this.db
              .prepare(
                "UPDATE builds SET artifactCleanupStartedAt=coalesce(artifactCleanupStartedAt,?) WHERE id=?",
              )
              .run(new Date(at).toISOString(), candidate.id);
            result.freedBytes += await this.removeArtifactFiles(candidate.id);
            this.db
              .prepare(
                "UPDATE builds SET artifactsDeletedAt=?,artifactCleanupStartedAt=NULL WHERE id=?",
              )
              .run(new Date(at).toISOString(), candidate.id);
            this.service.legacyReleases?.delete(candidate.id);
            result.artifacts++;
          });
        } catch (error) {
          result.errors.push({
            id: candidate.id,
            kind: "artifact",
            message: error.message,
          });
        }
      }
      for (const candidate of plan.logs) {
        try {
          if (
            !this.logExpired(
              this.db
                .prepare("SELECT * FROM builds WHERE id=?")
                .get(candidate.id),
              at,
            )
          )
            continue;
          const file = await this.managedPath("logs", `${candidate.id}.log`);
          if (file) {
            const bytes = await directorySize(file);
            await rm(file);
            result.freedBytes += bytes;
          }
          this.db
            .prepare("UPDATE builds SET logDeletedAt=? WHERE id=?")
            .run(new Date(at).toISOString(), candidate.id);
          result.logs++;
        } catch (error) {
          result.errors.push({
            id: candidate.id,
            kind: "log",
            message: error.message,
          });
        }
      }
    } catch (error) {
      result.errors.push({ message: error.message });
    }
    result.finishedAt = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO settings(key,value) VALUES('storageLastRun',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(JSON.stringify(result));
    return result;
  }
  start() {
    const interval = this.service.config.cleanupIntervalMs ?? 3600000;
    if (interval > 0)
      this.timer = setInterval(() => {
        void this.cleanup("automatic").catch((error) =>
          console.error("自动清理失败：", error.message),
        );
      }, interval).unref();
  }
  async close() {
    clearInterval(this.timer);
    await this.running;
  }
}
