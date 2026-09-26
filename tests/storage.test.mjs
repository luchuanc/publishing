import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
  lstat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:net";
import { openStore } from "../server/store.mjs";
import { PublishingService } from "../server/service.mjs";
import { createApp } from "../server/app.mjs";
import { prepareLegacyReleases } from "../server/legacy.mjs";
const DAY = 86400000;
async function fixture(t, kind = "web") {
  const root = await mkdtemp(path.join(tmpdir(), "publishing-retention-"));
  const probe = createServer();
  await new Promise((r) => probe.listen(0, "127.0.0.1", r));
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));
  const config = {
    dataDir: root,
    host: "127.0.0.1",
    publicUrl: "http://127.0.0.1:18888",
    gameHost: "127.0.0.1",
    publicPort: port,
    seed: false,
    password: "retention-test-password",
    cleanupIntervalMs: 0,
  };
  const db = openStore(root),
    service = new PublishingService(db, config);
  await service.start();
  const app = createApp(service, config);
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${app.address().port}`;
  const headers = {
    "Content-Type": "application/json",
    "X-Publishing-Request": "1",
    Origin: config.publicUrl,
  };
  const auth = await fetch(origin + "/api/login", {
    method: "POST",
    headers,
    body: JSON.stringify({ password: config.password }),
  });
  headers.Cookie = auth.headers.get("set-cookie").split(";")[0];
  await service.addProject({
    id: "demo",
    name: "保留测试",
    repo: "git@github.com:owner/demo.git",
    branch: "main",
    installCommand: "",
    buildCommand: "echo test",
    outputDir: "dist",
    kind,
    appConfig:
      kind === "android" ? { gameUrl: "https://games.example.com/demo/" } : {},
  });
  const release = service.addRelease({
    projectId: "demo",
    title: "测试发布单",
    branch: "main",
    autoPublish: false,
  });
  const at = Date.now();
  const add = async (index, overrides = {}) => {
    const id = randomUUID(),
      finishedAt = new Date(at - (60 - index) * DAY).toISOString();
    const row = {
      id,
      status: "succeeded",
      createdAt: finishedAt,
      finishedAt,
      projectId: "demo",
      ...overrides,
    };
    const cfg = {
      ...service.project(row.projectId),
      kind,
      hostingLayout: "subpath",
    };
    db.prepare(
      "INSERT INTO builds(id,projectId,status,config,autoPublish,createdAt,finishedAt,releaseOrderId,sizeBytes) VALUES(?,?,?,?,0,?,?,?,?)",
    ).run(
      id,
      row.projectId,
      row.status,
      JSON.stringify(cfg),
      row.createdAt,
      row.finishedAt,
      row.releaseOrderId || release.id,
      5,
    );
    await mkdir(service.releaseDir(id));
    await writeFile(
      path.join(
        service.releaseDir(id),
        kind === "android" ? "app.apk" : "index.html",
      ),
      "build" + index,
    );
    await writeFile(path.join(root, "logs", id + ".log"), "log" + index);
    return service.build(id);
  };
  t.after(async () => {
    app.closeAllConnections();
    await new Promise((r) => app.close(r));
    await service.close();
    db.close();
    await rm(root, { recursive: true, force: true });
  });
  const api = (route, options = {}) =>
    fetch(origin + "/api" + route, {
      ...options,
      headers: { ...headers, ...options.headers },
    });
  return { root, db, service, at, add, api, origin, config };
}
async function versions(f, n = 14) {
  const rows = [];
  for (let i = 0; i < n; i++) rows.push(await f.add(i));
  f.db
    .prepare(
      "UPDATE projects SET currentReleaseId=?,previousReleaseId=? WHERE id=?",
    )
    .run(rows[0].id, rows[1].id, "demo");
  return rows;
}

test("retention protects current/previous plus ten successes, starts a full grace period and expires logs independently", async (t) => {
  const f = await fixture(t),
    rows = await versions(f);
  const legacy = path.join(f.root, "subpath-releases", rows[2].id);
  await mkdir(legacy, { recursive: true });
  await writeFile(path.join(legacy, "old-abcdefgh.js"), "legacy bytes");
  f.service.legacyReleases.add(rows[2].id);
  const preview = await f.service.storage.inspect(f.at);
  assert.equal(preview.cleanup.artifacts.length, 2);
  assert.ok(preview.cleanup.artifacts.every((b) => !b.ready));
  assert.equal(
    f.service.build(rows[2].id).cleanupEligibleAt,
    null,
    "preview must not mutate retention",
  );
  assert.equal(preview.projects[0].retainedBuilds, 14);
  assert.ok(preview.disk.availableBytes > 0);
  assert.equal(
    preview.usage.artifacts,
    rows.reduce((sum, _, i) => sum + Buffer.byteLength("build" + i), 0) + 12,
  );
  const start = await f.service.storage.cleanup("manual", f.at);
  assert.equal(start.artifacts, 0);
  assert.equal(start.logs, 14);
  assert.deepEqual(start.errors, []);
  const expired = await (await f.api("/builds/" + rows[0].id + "/log")).json();
  assert.equal(expired.expired, true);
  assert.equal(
    (await fetch(f.service.publicOrigin() + "/demo/old-abcdefgh.js")).status,
    200,
  );
  assert.equal(
    (await f.service.storage.cleanup("automatic", f.at + 7 * DAY - 1))
      .artifacts,
    0,
  );
  const pruned = await f.service.storage.cleanup("automatic", f.at + 7 * DAY);
  assert.equal(pruned.artifacts, 2);
  assert.deepEqual(pruned.errors, []);
  assert.equal(
    (await fetch(f.service.publicOrigin() + "/demo/old-abcdefgh.js")).status,
    404,
  );
  assert.equal((await fetch(f.service.publicOrigin() + "/demo/")).status, 200);
  assert.equal(f.service.project("demo").previousReleaseId, rows[1].id);
  await assert.rejects(lstat(legacy), { code: "ENOENT" });
  for (const i of [0, 1, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])
    assert.ok((await lstat(f.service.releaseDir(rows[i].id))).isDirectory());
  assert.equal(f.service.snapshot().builds.length, 14, "keep build history");
  await assert.rejects(f.service.publish("demo", rows[2].id), /产物已清理/);
  assert.equal(
    (await f.service.storage.cleanup("manual", f.at + 8 * DAY)).artifacts,
    0,
    "idempotent",
  );
});

test("republishing and rollback reset the grace clock, and deleted orders obey the same protection", async (t) => {
  const f = await fixture(t),
    rows = await versions(f);
  f.service.storage.reconcile(f.at - 8 * DAY);
  await f.service.publish("demo", rows[2].id);
  assert.equal(f.service.build(rows[2].id).cleanupEligibleAt, null);
  await f.service.publish("demo", rows[13].id);
  await f.service.publish("demo", rows[12].id);
  assert.ok(Date.parse(f.service.build(rows[2].id).cleanupEligibleAt) >= f.at);
  assert.equal(
    f.service.storage
      .plan(f.at + DAY)
      .artifacts.find((b) => b.id === rows[2].id).ready,
    false,
  );
  await f.service.rollback("demo");
  assert.equal(f.service.project("demo").currentReleaseId, rows[13].id);
  const obsolete = f.service.addRelease({
    projectId: "demo",
    title: "隐藏的发布单",
    branch: "main",
    autoPublish: false,
  });
  f.db
    .prepare("UPDATE builds SET releaseOrderId=? WHERE id=?")
    .run(obsolete.id, rows[3].id);
  f.service.deleteRelease(obsolete.id);
  const result = await f.service.storage.cleanup("manual", f.at + DAY);
  assert.equal(result.artifacts, 1);
  assert.ok(
    f.db
      .prepare("SELECT artifactsDeletedAt FROM builds WHERE id=?")
      .get(rows[3].id).artifactsDeletedAt,
  );
  assert.equal((await fetch(f.service.publicOrigin() + "/demo/")).status, 200);
});

test("cleanup and publish serialize artifact mutation; a deleted candidate can never become live", async (t) => {
  const f = await fixture(t),
    rows = await versions(f);
  f.service.storage.reconcile(f.at - 8 * DAY);
  let entered, proceed;
  const waiting = new Promise((r) => (entered = r)),
    gate = new Promise((r) => (proceed = r));
  const remove = f.service.storage.removeArtifactFiles.bind(f.service.storage);
  let first = true;
  f.service.storage.removeArtifactFiles = async (id) => {
    if (first) {
      first = false;
      entered(id);
      await gate;
    }
    return remove(id);
  };
  const cleanup = f.service.storage.cleanup("manual", f.at);
  const id = await waiting;
  const publish = assert.rejects(f.service.publish("demo", id), /产物已清理/);
  proceed();
  await cleanup;
  await publish;
  assert.equal(f.service.project("demo").currentReleaseId, rows[0].id);
  assert.equal((await fetch(f.service.publicOrigin() + "/demo/")).status, 200);
});

test("failed deletion stays unavailable and retries, legacy migration cannot recreate it, symlinks are never traversed", async (t) => {
  const f = await fixture(t),
    rows = await versions(f);
  f.service.storage.reconcile(f.at - 8 * DAY);
  const outside = await mkdtemp(path.join(tmpdir(), "retention-outside-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(path.join(outside, "keep"), "untouched");
  const original = f.service.storage.removeArtifactFiles.bind(
    f.service.storage,
  );
  f.service.storage.removeArtifactFiles = async (id) => {
    if (id === rows[2].id) throw Error("simulated IO failure");
    return original(id);
  };
  let result = await f.service.storage.cleanup("manual", f.at);
  assert.equal(result.errors.length, 1);
  assert.ok(f.service.build(rows[2].id).artifactCleanupStartedAt);
  await assert.rejects(f.service.publish("demo", rows[2].id), /已清理/);
  await prepareLegacyReleases(f.service);
  f.service.storage.removeArtifactFiles = original;
  await rm(f.service.releaseDir(rows[2].id), { recursive: true });
  await symlink(outside, f.service.releaseDir(rows[2].id));
  result = await f.service.storage.cleanup("manual", f.at);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].message, /符号链接/);
  assert.equal(await readFile(path.join(outside, "keep"), "utf8"), "untouched");
  await rm(f.service.releaseDir(rows[2].id));
  await mkdir(f.service.releaseDir(rows[2].id));
  result = await f.service.storage.cleanup("manual", f.at);
  assert.equal(result.artifacts, 1);
  assert.deepEqual(result.errors, []);
});

test("APK expiry returns 410 and hides download links, while active/recent logs survive and API requires auth and CSRF", async (t) => {
  const f = await fixture(t, "android"),
    rows = await versions(f);
  const active = await f.add(15, { status: "running" });
  const recent = await f.add(16, {
    status: "failed",
    finishedAt: new Date(f.at - 29 * DAY).toISOString(),
  });
  f.service.storage.reconcile(f.at - 8 * DAY);
  assert.equal((await fetch(f.origin + "/api/storage")).status, 401);
  assert.equal(
    (
      await fetch(f.origin + "/api/storage/cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
    ).status,
    403,
  );
  const response = await f.api("/storage/cleanup", {
    method: "POST",
    body: "{}",
  });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).errors, []);
  assert.equal((await fetch(f.service.downloadUrl(rows[2]))).status, 410);
  assert.equal(
    f.service.snapshot().builds.find((b) => b.id === rows[2].id).downloadUrl,
    null,
  );
  assert.equal(
    (await fetch(f.service.address(f.service.project("demo")))).status,
    200,
  );
  assert.ok(
    await readFile(path.join(f.root, "logs", active.id + ".log"), "utf8"),
  );
  assert.ok(
    await readFile(path.join(f.root, "logs", recent.id + ".log"), "utf8"),
  );
  const report = await (await f.api("/storage")).json();
  assert.equal(report.lastRun.source, "manual");
  assert.equal(report.cleanup.reclaimableBytes, 0);
});

test("hourly scheduler invokes the same cleanup and stops when the service closes", async (t) => {
  const f = await fixture(t);
  await f.add(0, { status: "failed" });
  f.config.cleanupIntervalMs = 20;
  f.service.storage.start();
  for (let i = 0; i < 100; i++) {
    if (JSON.parse(f.service.setting("storageLastRun")).source === "automatic")
      break;
    await new Promise((r) => setTimeout(r, 10));
  }
  const last = JSON.parse(f.service.setting("storageLastRun"));
  assert.equal(last.source, "automatic");
  await f.service.storage.close();
  assert.equal(f.service.storage.timer._destroyed, true);
  assert.equal((await f.service.storage.inspect()).usage.logs, 0);
});

test("each project keeps its own ten successes, including archived projects and their live references", async (t) => {
  const f = await fixture(t);
  const first = await versions(f);
  await f.service.addProject({
    ...f.service.project("demo"),
    id: "second",
    name: "第二个项目",
  });
  const order = f.service.addRelease({
    projectId: "second",
    title: "独立保留",
    branch: "main",
    autoPublish: false,
  });
  const second = [];
  for (let i = 0; i < 13; i++)
    second.push(
      await f.add(i, { projectId: "second", releaseOrderId: order.id }),
    );
  f.db
    .prepare(
      "UPDATE projects SET archived=1,currentReleaseId=?,previousReleaseId=? WHERE id='second'",
    )
    .run(second[0].id, second[1].id);
  f.service.storage.reconcile(f.at - 8 * DAY);
  const result = await f.service.storage.cleanup("manual", f.at);
  assert.equal(result.artifacts, 3);
  assert.deepEqual(result.errors, []);
  for (const [rows, removed] of [
    [first, [2, 3]],
    [second, [2]],
  ]) {
    for (let i = 0; i < rows.length; i++)
      assert.equal(
        !!f.service.build(rows[i].id).artifactsDeletedAt,
        removed.includes(i),
      );
  }
  const report = await f.service.storage.inspect();
  assert.deepEqual(
    report.projects.map((p) => p.retainedBuilds),
    [12, 12],
  );
});

test("service restart preserves grace deadlines, retries interrupted deletion and protects current/previous", async (t) => {
  const f = await fixture(t),
    rows = await versions(f);
  f.service.storage.reconcile(f.at - DAY);
  const deadline = f.service.build(rows[2].id).cleanupEligibleAt;
  f.db
    .prepare("UPDATE builds SET artifactCleanupStartedAt=? WHERE id=?")
    .run(new Date(f.at).toISOString(), rows[3].id);
  await f.service.close();
  const resumed = new PublishingService(f.db, f.config);
  try {
    await resumed.start();
    assert.equal(resumed.build(rows[2].id).cleanupEligibleAt, deadline);
    assert.equal(resumed.build(rows[2].id).artifactsDeletedAt, null);
    assert.ok(resumed.build(rows[3].id).artifactsDeletedAt);
    assert.ok(resumed.build(rows[0].id).logDeletedAt);
    assert.equal(resumed.project("demo").previousReleaseId, rows[1].id);
    assert.equal((await fetch(resumed.publicOrigin() + "/demo/")).status, 200);
    assert.equal(
      JSON.parse(resumed.setting("storageLastRun")).source,
      "startup",
    );
  } finally {
    await resumed.close();
  }
});
