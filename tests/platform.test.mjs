import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { openStore, acquireInstanceLock } from "../server/store.mjs";
import { PublishingService, validateProject } from "../server/service.mjs";
import { createApp } from "../server/app.mjs";
import { command, buildEnvironment, buildLog } from "../server/runner.mjs";

const base = {
  id: "demo",
  name: "测试游戏",
  repo: "git@github.com:owner/demo.git",
  branch: "main",
  installCommand: "",
  buildCommand: "node build.cjs",
  outputDir: "dist",
  publicUrl: "",
};
async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "publishing-test-"));
  const repo = path.join(root, "source");
  await mkdir(repo);
  const git = (...args) =>
    execFileSync("git", args, { cwd: repo, stdio: "pipe" });
  git("init", "-b", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.com");
  await writeFile(
    path.join(repo, "build.cjs"),
    "const fs=require('node:fs');fs.mkdirSync('dist',{recursive:true});fs.copyFileSync('page.html','dist/index.html');fs.writeFileSync('dist/bundle-abcdefgh.js','v1');",
  );
  await writeFile(path.join(repo, "page.html"), "version one");
  git("add", ".");
  git("commit", "-m", "first");
  const port = await freePort();
  const config = {
    dataDir: path.join(root, "data"),
    host: "127.0.0.1",
    publicUrl: "http://localhost:18888",
    gameHost: "127.0.0.1",
    portStart: port,
    portEnd: port + 5,
    timeoutMs: 15000,
    seed: false,
    secure: false,
    password: "testing-password-123456",
  };
  const db = openStore(config.dataDir);
  const executor = (bin, args, options) =>
    command(
      bin,
      bin === "git"
        ? args.map((a) => (a === base.repo ? `file://${repo}` : a))
        : args,
      options,
    );
  const service = new PublishingService(db, config, executor);
  await service.start();
  const app = createApp(service, config);
  await new Promise((resolve) => app.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${app.address().port}`;
  t.after(async () => {
    app.closeAllConnections();
    await new Promise((resolve) => app.close(resolve));
    await service.close();
    db.close();
    await rm(root, { recursive: true, force: true });
  });
  await service.addProject(base);
  const build = async (auto = true) => {
    const b = service.enqueue("demo", auto);
    await service.work;
    return service.build(b.id);
  };
  return { root, repo, git, config, db, service, url, build };
}

test("remote clone, real build, publish, rollback, stale guard and immutable bundles", async (t) => {
  const { service, build, repo, git } = await fixture(t);
  const first = await build();
  assert.equal(first.status, "succeeded");
  assert.match(first.commitHash, /^[a-f0-9]{40}$/);
  const url = service.address(service.project("demo"));
  assert.equal(await (await fetch(url)).text(), "version one");
  await writeFile(path.join(repo, "page.html"), "version two");
  await writeFile(
    path.join(repo, "build.cjs"),
    "const fs=require('node:fs');fs.mkdirSync('dist');fs.copyFileSync('page.html','dist/index.html');fs.writeFileSync('dist/bundle-ijklmnop.js','v2');",
  );
  git("add", ".");
  git("commit", "-m", "second");
  const second = await build();
  assert.equal(second.status, "succeeded");
  assert.equal(await (await fetch(url)).text(), "version two");
  assert.equal(await (await fetch(url + "bundle-abcdefgh.js")).text(), "v1");
  await service.rollback("demo", second.id);
  const response = await fetch(url);
  assert.equal(await response.text(), "version one");
  assert.equal(response.headers.get("x-release-id"), first.id);
  await assert.rejects(service.rollback("demo", second.id), /当前版本已变化/);
  await service.rollback("demo", first.id);
  assert.equal(await (await fetch(url)).text(), "version two");
  assert.equal(
    service.snapshot().events.filter((e) => e.action === "rollback").length,
    2,
  );
});

test("build-only does not go live; failed builds preserve current version", async (t) => {
  const { service, build } = await fixture(t);
  const first = await build(false);
  assert.equal(first.status, "succeeded");
  assert.equal(service.project("demo").currentReleaseId, null);
  assert.equal(
    (await fetch(service.address(service.project("demo")))).status,
    503,
  );
  await service.publish("demo", first.id);
  await service.updateProject("demo", { buildCommand: "exit 23" });
  const failed = await build();
  assert.equal(failed.status, "failed");
  assert.match(failed.error, /23/);
  assert.equal(service.project("demo").currentReleaseId, first.id);
  assert.equal(
    await (await fetch(service.address(service.project("demo")))).text(),
    "version one",
  );
  await assert.rejects(service.publish("demo", failed.id), /成功产物/);
});

test("queued/running cancellation and duplicate builds", async (t) => {
  const { service } = await fixture(t);
  await service.updateProject("demo", { buildCommand: "sleep 15" });
  const first = service.enqueue("demo");
  assert.throws(() => service.enqueue("demo"), /已有/);
  service.cancel(first.id);
  await service.work;
  assert.equal(service.build(first.id).status, "cancelled");
  const second = service.enqueue("demo");
  await new Promise((resolve) => setTimeout(resolve, 200));
  service.cancel(second.id);
  await service.work;
  assert.equal(service.build(second.id).status, "cancelled");
  assert.equal(service.project("demo").currentReleaseId, null);
});

test("authentication, CSRF, session logout, validation and hidden files", async (t) => {
  const { url, config, service, build } = await fixture(t);
  assert.equal((await fetch(url + "/api/state")).status, 401);
  const headers = {
    "Content-Type": "application/json",
    "X-Publishing-Request": "1",
    Origin: config.publicUrl,
  };
  const login = (body) =>
    fetch(url + "/api/login", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  assert.equal((await login({ password: "incorrect" })).status, 401);
  assert.equal(
    (
      await fetch(url + "/api/login", {
        method: "POST",
        headers: { ...headers, Origin: "http://evil.invalid" },
        body: JSON.stringify({ password: config.password }),
      })
    ).status,
    403,
  );
  const response = await login({ password: config.password });
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie");
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  headers.Cookie = cookie.split(";")[0];
  assert.equal((await fetch(url + "/api/state", { headers })).status, 200);
  const result = await fetch(url + "/api/projects", {
    method: "POST",
    headers,
    body: JSON.stringify({ ...base, id: "bad", outputDir: "../secret" }),
  });
  assert.equal(result.status, 400);
  assert.equal(
    (
      await fetch(url + "/api/projects/demo/rollback", {
        method: "POST",
        headers: { Cookie: headers.Cookie, "Content-Type": "application/json" },
        body: "{}",
      })
    ).status,
    403,
  );
  await build();
  const gameUrl = service.address(service.project("demo"));
  assert.equal((await fetch(gameUrl + ".git/config")).status, 404);
  assert.equal((await fetch(gameUrl + "%2e%2e%2f.env")).status, 404);
  assert.equal((await fetch(gameUrl + "api/state")).status, 404);
  const head = await fetch(gameUrl, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  const range = await fetch(gameUrl, { headers: { Range: "bytes=0-6" } });
  assert.equal(range.status, 206);
  assert.equal(await range.text(), "version");
  assert.equal(
    (await fetch(url + "/api/logout", { method: "POST", headers, body: "{}" }))
      .status,
    200,
  );
  assert.equal((await fetch(url + "/api/state", { headers })).status, 401);
});

test("archive stops hosting, restore reuses address and versions", async (t) => {
  const { service, build } = await fixture(t);
  const b = await build();
  const before = service.address(service.project("demo"));
  await service.archiveProject("demo", true);
  assert.equal(service.servers.has("demo"), false);
  assert.throws(() => service.enqueue("demo"), /恢复/);
  await service.archiveProject("demo", false);
  assert.equal(service.address(service.project("demo")), before);
  assert.equal(service.project("demo").currentReleaseId, b.id);
  assert.equal((await fetch(before)).status, 200);
});

test("symlink artifacts cannot expose files outside repository", async (t) => {
  const { service, build } = await fixture(t);
  await service.updateProject("demo", {
    buildCommand: "node build.cjs && ln -s /etc/passwd dist/leak.txt",
  });
  const b = await build();
  assert.equal(b.status, "failed");
  assert.match(b.error, /符号链接/);
  assert.equal(service.project("demo").currentReleaseId, null);
});

test("interrupted builds fail on restart; queued work resumes and release stays live", async (t) => {
  const { service, db, build, config } = await fixture(t);
  const first = await build();
  await service.close();
  const interrupted = "b1d15bca-2efe-4f58-8d26-7fb9a4fa0000";
  db.prepare(
    "INSERT INTO builds(id,projectId,status,config,autoPublish,createdAt) VALUES(?,'demo','running',?,1,?)",
  ).run(interrupted, JSON.stringify(base), new Date().toISOString());
  const queued = "b1d15bca-2efe-4f58-8d26-7fb9a4fa0001";
  db.prepare(
    "INSERT INTO builds(id,projectId,status,config,autoPublish,createdAt) VALUES(?,'demo','queued',?,0,?)",
  ).run(queued, JSON.stringify(base), new Date().toISOString());
  const resumed = new PublishingService(db, config, service.executor);
  t.after(() => resumed.close());
  await resumed.start();
  await resumed.work;
  assert.equal(resumed.build(queued).status, "succeeded");
  assert.equal(resumed.build(interrupted).status, "failed");
  assert.equal(resumed.project("demo").currentReleaseId, first.id);
  assert.equal(
    await (await fetch(resumed.address(resumed.project("demo")))).text(),
    "version one",
  );
  await resumed.close();
});

test("commands time out, logs are bounded, secrets do not enter child environment", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "publishing-runner-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "log");
  const log = buildLog(file);
  await assert.rejects(
    command("/bin/sh", ["-c", "sleep 20"], { cwd: dir, log, timeoutMs: 80 }),
    /超时/,
  );
  log.write("x".repeat(5 * 1024 * 1024));
  await log.close();
  assert.ok((await readFile(file)).length < 1024);
  process.env.ADMIN_PASSWORD = "do-not-forward";
  assert.equal(buildEnvironment().ADMIN_PASSWORD, undefined);
  assert.equal(buildEnvironment().NODE_ENV, "production");
  assert.equal(buildEnvironment().npm_config_include, "dev");
  delete process.env.ADMIN_PASSWORD;
});

test("rejects unsafe repository, output paths and bad identifiers", () => {
  for (const changes of [
    { repo: "file:///tmp/repo.git" },
    { repo: "https://user:secret@example.com/repo.git" },
    { repo: "--upload-pack=evil" },
    { outputDir: "../dist" },
    { outputDir: "." },
    { outputDir: "src" },
    { id: "../oops" },
    { branch: "--config=x" },
    { publicUrl: "javascript:alert(1)" },
    { publicUrl: "https://example.com/path/" },
  ])
    assert.throws(() => validateProject({ ...base, ...changes }));
  assert.equal(validateProject(base).id, "demo");
});

test("instance lock prevents parallel startup and is reusable after release", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "publishing-lock-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const first = acquireInstanceLock(directory);
  assert.throws(() => acquireInstanceLock(directory), /已有平台实例/);
  first.close();
  const next = acquireInstanceLock(directory);
  next.close();
});
