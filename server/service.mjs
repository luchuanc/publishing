import { createServer } from "node:http";
import { closeHttpServer } from "./http-lifecycle.mjs";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  rm,
  cp,
  readdir,
  lstat,
  stat,
  readFile,
  realpath,
} from "node:fs/promises";
import path from "node:path";
import { transaction } from "./store.mjs";
import { command, buildLog } from "./runner.mjs";
import { serveFile } from "./static.mjs";

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const fail = (message, status = 400) => {
  throw new HttpError(status, message);
};
const now = () => new Date().toISOString();
const running = ["queued", "running"];

export function validateProject(value) {
  const fields = {};
  for (const key of [
    "id",
    "name",
    "repo",
    "branch",
    "installCommand",
    "buildCommand",
    "outputDir",
    "publicUrl",
  ]) {
    if (typeof value[key] !== "string") fail(`缺少配置：${key}`);
    fields[key] = value[key].trim();
  }
  if (!/^[a-zA-Z][a-zA-Z0-9-]{1,39}$/.test(fields.id))
    fail("游戏标识应为 2–40 位英文字母、数字或连字符");
  if (!fields.name || fields.name.length > 80) fail("游戏名称应为 1–80 字符");
  const ssh = /^git@[a-zA-Z0-9.-]+:[a-zA-Z0-9_./-]+\.git$/.test(fields.repo);
  let https = false;
  try {
    const url = new URL(fields.repo);
    https =
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname.endsWith(".git");
  } catch {}
  if ((!ssh && !https) || fields.repo.length > 500)
    fail("仓库必须使用 git@host:owner/repo.git 或不含密码的 HTTPS Git 地址");
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9_./-]{0,149}$/.test(fields.branch) ||
    fields.branch.includes("..") ||
    fields.branch.includes("//") ||
    fields.branch.endsWith("/") ||
    fields.branch.endsWith(".lock")
  )
    fail("Git 分支名称无效");
  if (
    !fields.buildCommand ||
    fields.buildCommand.length > 2000 ||
    fields.installCommand.length > 2000
  )
    fail("请填写有效构建命令（最多 2000 字符）");
  if (
    !/^[a-zA-Z0-9_-][a-zA-Z0-9_./-]{0,149}$/.test(fields.outputDir) ||
    fields.outputDir.split("/").some((p) => p === ".." || p.startsWith(".")) ||
    /^(node_modules|src)(\/|$)/.test(fields.outputDir)
  )
    fail("产物目录必须是项目内独立的相对目录，例如 dist");
  if (fields.publicUrl) {
    try {
      const url = new URL(fields.publicUrl);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.pathname !== "/" ||
        url.search ||
        url.hash
      )
        throw new Error();
      fields.publicUrl = url.origin;
    } catch {
      fail(
        "自定义访问地址必须是独立域名的完整根地址，例如 https://game.example.com",
      );
    }
  }
  return fields;
}

async function artifactSize(directory) {
  let size = 0;
  for (const file of await readdir(directory, { withFileTypes: true })) {
    if (file.name.startsWith(".") || file.name === "node_modules")
      throw new Error("产物包含隐藏文件或 node_modules，请检查产物目录");
    const location = path.join(directory, file.name);
    const info = await lstat(location);
    if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile()))
      throw new Error("产物不能包含符号链接或特殊文件");
    size += info.isDirectory() ? await artifactSize(location) : info.size;
  }
  return size;
}

export class PublishingService {
  constructor(db, config, executor = command) {
    this.db = db;
    this.config = config;
    this.executor = executor;
    this.servers = new Map();
    this.portErrors = new Map();
    this.active = null;
    this.work = null;
    this.stopping = false;
  }
  project(id) {
    const result = this.db.prepare("SELECT * FROM projects WHERE id=?").get(id);
    if (!result) fail("游戏不存在", 404);
    return result;
  }
  build(id) {
    const result = this.db
      .prepare(
        `SELECT b.* FROM builds b LEFT JOIN release_orders r ON r.id=b.releaseOrderId
      WHERE b.id=? AND r.deletedAt IS NULL`,
      )
      .get(id);
    if (!result) fail("构建不存在", 404);
    return result;
  }
  release(id) {
    const result = this.db
      .prepare("SELECT * FROM release_orders WHERE id=? AND deletedAt IS NULL")
      .get(id);
    if (!result) fail("发布单不存在", 404);
    return result;
  }
  async branches(id) {
    const p = this.project(id);
    let output = "";
    const controller = new AbortController();
    try {
      await this.executor("git", ["ls-remote", "--heads", "--", p.repo], {
        cwd: this.config.dataDir,
        timeoutMs: 20000,
        signal: controller.signal,
        log: {
          write(chunk) {
            output += String(chunk);
            if (output.length > 1024 * 1024) controller.abort();
          },
        },
      });
    } catch {
      fail(
        "读取远端分支失败，请检查仓库地址及服务器的 Git 访问权限后重试",
        502,
      );
    }
    const branches = [
      ...new Set(
        output.split(/\r?\n/).flatMap((line) => {
          const match = /^[0-9a-f]+\s+refs\/heads\/(.+)$/.exec(line);
          return match ? [match[1]] : [];
        }),
      ),
    ].sort();
    return { branches, defaultBranch: p.branch };
  }
  releaseFields(input) {
    const p = this.project(String(input.projectId || ""));
    const branch = validateProject({ ...p, branch: input.branch }).branch;
    const title = typeof input.title === "string" ? input.title.trim() : "";
    const notes = typeof input.notes === "string" ? input.notes.trim() : "";
    if (title.length > 100 || notes.length > 2000)
      fail("发布单名称最多 100 字符，说明最多 2000 字符");
    if (
      input.autoPublish !== undefined &&
      typeof input.autoPublish !== "boolean" &&
      ![0, 1].includes(input.autoPublish)
    )
      fail("自动发布配置无效");
    return {
      projectId: p.id,
      title: title || `${p.name} · ${branch}`.slice(0, 100),
      branch,
      notes,
      autoPublish:
        input.autoPublish === undefined ? 1 : Number(!!input.autoPublish),
    };
  }
  addRelease(input) {
    const r = this.releaseFields(input);
    if (this.project(r.projectId).archived) fail("请先恢复已归档的项目", 409);
    const id = randomUUID(),
      date = now();
    this.db
      .prepare(
        "INSERT INTO release_orders(id,projectId,title,branch,autoPublish,notes,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        r.projectId,
        r.title,
        r.branch,
        r.autoPublish,
        r.notes,
        date,
        date,
      );
    this.event(r.projectId, "release_created", id);
    return this.release(id);
  }
  updateRelease(id, input) {
    const old = this.release(id);
    if (
      this.db
        .prepare(
          "SELECT id FROM builds WHERE releaseOrderId=? AND (status IN ('queued','running') OR id=?)",
        )
        .get(id, this.active?.id || "")
    )
      fail("请等待或取消当前构建后再编辑发布单", 409);
    if (input.expectedUpdatedAt && input.expectedUpdatedAt !== old.updatedAt)
      fail("发布单已被修改，请刷新后重试", 409);
    const r = this.releaseFields({ ...old, ...input });
    if (
      r.projectId !== old.projectId &&
      this.db
        .prepare("SELECT id FROM builds WHERE releaseOrderId=? LIMIT 1")
        .get(id)
    )
      fail("已有构建记录的发布单不能更换项目，请新建发布单", 409);
    if (r.projectId !== old.projectId && this.project(r.projectId).archived)
      fail("请先恢复已归档的项目", 409);
    this.db
      .prepare(
        "UPDATE release_orders SET projectId=?,title=?,branch=?,autoPublish=?,notes=?,updatedAt=? WHERE id=?",
      )
      .run(
        r.projectId,
        r.title,
        r.branch,
        r.autoPublish,
        r.notes,
        new Date(
          Math.max(Date.now(), Date.parse(old.updatedAt) + 1),
        ).toISOString(),
        id,
      );
    this.event(r.projectId, "release_updated", id);
    return this.release(id);
  }
  deleteRelease(id) {
    const r = this.release(id);
    if (
      this.db
        .prepare(
          "SELECT id FROM builds WHERE releaseOrderId=? AND (status IN ('queued','running') OR id=?)",
        )
        .get(id, this.active?.id || "")
    )
      fail("请先取消或等待构建完成，再删除发布单", 409);
    if (
      this.db
        .prepare(
          `SELECT b.id FROM builds b JOIN projects p ON p.currentReleaseId=b.id OR p.previousReleaseId=b.id WHERE b.releaseOrderId=?`,
        )
        .get(id)
    )
      fail("此发布单包含当前线上版本或上一版，暂不能删除", 409);
    // Retain immutable artifacts for clients that still request older bundles.
    this.db
      .prepare("UPDATE release_orders SET deletedAt=?,updatedAt=? WHERE id=?")
      .run(now(), now(), id);
    this.event(r.projectId, "release_deleted", id);
  }
  releaseDir(id) {
    return path.join(this.config.dataDir, "releases", id);
  }
  address(project) {
    return project.publicUrl
      ? project.publicUrl + "/"
      : `http://${this.config.gameHost}:${project.port}/`;
  }
  event(projectId, action, releaseId = null, fromReleaseId = null) {
    this.db
      .prepare(
        "INSERT INTO events(projectId,action,releaseId,fromReleaseId,createdAt) VALUES(?,?,?,?,?)",
      )
      .run(projectId, action, releaseId, fromReleaseId, now());
  }
  async start() {
    await mkdir(path.join(this.config.dataDir, "logs"), { recursive: true });
    await mkdir(path.join(this.config.dataDir, "releases"), {
      recursive: true,
    });
    await mkdir(path.join(this.config.dataDir, "work"), { recursive: true });
    // No in-flight checkout can survive a service restart. Release directories
    // are separate, so clearing these remnants does not affect online games.
    for (const name of await readdir(path.join(this.config.dataDir, "work"))) {
      await rm(path.join(this.config.dataDir, "work", name), {
        recursive: true,
        force: true,
      });
    }
    this.db
      .prepare(
        "UPDATE builds SET status='failed', error='服务重启中断了构建，请重新打包', finishedAt=? WHERE status='running'",
      )
      .run(now());
    if (
      this.config.seed &&
      this.db.prepare("SELECT count(*) AS n FROM projects").get().n === 0
    ) {
      for (const [id, name, installCommand] of [
        ["zizou", "山海弈", "npm ci"],
        ["xiangsu", "像素远征", "npm ci"],
        ["backHome", "最后一家回收站", ""],
      ]) {
        await this.addProject({
          id,
          name,
          repo: `git@github.com:luchuanc/${id}.git`,
          branch: "main",
          installCommand,
          buildCommand: "npm run build",
          outputDir: "dist",
          publicUrl: "",
        });
      }
    }
    for (const p of this.db
      .prepare("SELECT * FROM projects WHERE archived=0")
      .all()) {
      try {
        await this.listenGame(p);
      } catch (error) {
        this.portErrors.set(p.id, error.message);
      }
    }
    this.kick();
  }
  snapshot() {
    const builds = this.db
      .prepare(
        `SELECT b.* FROM builds b LEFT JOIN release_orders r ON r.id=b.releaseOrderId
        WHERE r.deletedAt IS NULL ORDER BY b.createdAt DESC, b.rowid DESC`,
      )
      .all()
      .map(({ config, ...b }) => ({ ...b, branch: JSON.parse(config).branch }));
    const releases = this.db
      .prepare(
        "SELECT * FROM release_orders WHERE deletedAt IS NULL ORDER BY createdAt DESC, rowid DESC",
      )
      .all()
      .map((r) => {
        const attempts = builds.filter((b) => b.releaseOrderId === r.id);
        return {
          ...r,
          buildCount: attempts.length,
          latestBuild: attempts[0] || null,
        };
      });
    const projects = this.db
      .prepare("SELECT * FROM projects ORDER BY createdAt, id")
      .all()
      .map((p) => ({
        ...p,
        url: this.address(p),
        servingError: this.portErrors.get(p.id) || null,
        currentRelease: builds.find((b) => b.id === p.currentReleaseId) || null,
        latestBuild: builds.find((b) => b.projectId === p.id) || null,
      }));
    return {
      projects,
      builds,
      releases,
      events: this.db
        .prepare("SELECT * FROM events ORDER BY id DESC LIMIT 100")
        .all(),
      system: {
        publicUrl: this.config.publicUrl,
        gameHost: this.config.gameHost,
        portStart: this.config.portStart,
        portEnd: this.config.portEnd,
        activeBuildId: this.active?.id || null,
        node: process.version,
      },
    };
  }
  async addProject(input) {
    const p = validateProject(input);
    if (this.db.prepare("SELECT id FROM projects WHERE id=?").get(p.id))
      fail("游戏标识已存在", 409);
    if (p.publicUrl === this.config.publicUrl)
      fail("游戏访问地址不能与管理后台相同");
    const used = new Set(
      this.db
        .prepare("SELECT port FROM projects")
        .all()
        .map((x) => x.port),
    );
    let port = this.config.portStart;
    while (used.has(port)) port++;
    if (port > this.config.portEnd)
      fail("游戏端口范围已用完，请扩大 GAME_PORT_END", 409);
    p.port = port;
    await this.listenGame(p);
    try {
      this.db
        .prepare(
          "INSERT INTO projects(id,name,repo,branch,installCommand,buildCommand,outputDir,port,publicUrl,createdAt) VALUES(?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          p.id,
          p.name,
          p.repo,
          p.branch,
          p.installCommand,
          p.buildCommand,
          p.outputDir,
          port,
          p.publicUrl,
          now(),
        );
      this.event(p.id, "created");
    } catch (error) {
      await this.closeGame(p.id);
      throw error;
    }
    return this.project(p.id);
  }
  async updateProject(id, input) {
    const old = this.project(id);
    const p = validateProject({ ...old, ...input, id });
    if (p.publicUrl === this.config.publicUrl)
      fail("游戏访问地址不能与管理后台相同");
    if (
      this.db
        .prepare(
          "SELECT id FROM builds WHERE projectId=? AND status IN ('queued','running')",
        )
        .get(id)
    )
      fail("请等待当前构建结束再修改配置", 409);
    this.db
      .prepare(
        "UPDATE projects SET name=?,repo=?,branch=?,installCommand=?,buildCommand=?,outputDir=?,publicUrl=? WHERE id=?",
      )
      .run(
        p.name,
        p.repo,
        p.branch,
        p.installCommand,
        p.buildCommand,
        p.outputDir,
        p.publicUrl,
        id,
      );
    this.event(id, "updated");
    if (!old.archived && !this.servers.has(id))
      await this.listenGame(this.project(id));
    return this.project(id);
  }
  async archiveProject(id, archived) {
    const p = this.project(id);
    if (
      this.db
        .prepare(
          "SELECT id FROM builds WHERE projectId=? AND status IN ('queued','running')",
        )
        .get(id)
    )
      fail("请先取消或等待构建完成", 409);
    if (!archived) await this.listenGame(p);
    this.db
      .prepare("UPDATE projects SET archived=? WHERE id=?")
      .run(archived ? 1 : 0, id);
    this.event(id, archived ? "archived" : "restored");
    if (archived) await this.closeGame(id);
  }
  enqueue(id, autoPublish = true) {
    // Keep the original endpoint compatible while every new build belongs to an order.
    const p = this.project(id);
    this.assertBuildAvailable(p);
    const r = this.addRelease({ projectId: id, branch: p.branch, autoPublish });
    return this.enqueueRelease(r.id);
  }
  assertBuildAvailable(p) {
    if (p.archived) fail("请先恢复已归档的游戏", 409);
    if (
      this.db
        .prepare(
          "SELECT id FROM builds WHERE projectId=? AND status IN ('queued','running')",
        )
        .get(p.id)
    )
      fail("该游戏已有排队或运行中的构建", 409);
    if (this.stopping) fail("平台正在关闭，请稍后重试", 503);
  }
  enqueueRelease(id) {
    const r = this.release(id);
    const p = this.project(r.projectId);
    const buildId = randomUUID();
    transaction(this.db, () => {
      this.assertBuildAvailable(p);
      this.db
        .prepare(
          "INSERT INTO builds(id,projectId,status,config,autoPublish,createdAt,releaseOrderId) VALUES(?,?,'queued',?,?,?,?)",
        )
        .run(
          buildId,
          p.id,
          JSON.stringify({ ...p, branch: r.branch }),
          r.autoPublish,
          now(),
          r.id,
        );
    });
    this.kick();
    return this.build(buildId);
  }
  kick() {
    if (this.work || this.stopping) return;
    this.work = Promise.resolve()
      .then(async () => {
        while (!this.stopping) {
          const build = this.db
            .prepare(
              "SELECT * FROM builds WHERE status='queued' ORDER BY createdAt,rowid LIMIT 1",
            )
            .get();
          if (!build) break;
          await this.runBuild(build);
        }
      })
      .catch((error) => console.error("构建队列异常：", error.message))
      .finally(() => {
        this.work = null;
      });
  }
  async runBuild(build) {
    const p = JSON.parse(build.config);
    const workDir = path.join(this.config.dataDir, "work", build.id);
    const checkout = path.join(workDir, "repo");
    const log = buildLog(
      path.join(this.config.dataDir, "logs", `${build.id}.log`),
    );
    const controller = new AbortController();
    this.active = { id: build.id, controller };
    this.db
      .prepare("UPDATE builds SET status='running', startedAt=? WHERE id=?")
      .run(now(), build.id);
    const deadline = Date.now() + this.config.timeoutMs;
    const run = (bin, args, cwd) =>
      this.executor(bin, args, {
        cwd,
        log,
        signal: controller.signal,
        timeoutMs: Math.max(1, deadline - Date.now()),
      });
    try {
      await mkdir(workDir, { recursive: true });
      log.write(`[${now()}] 开始构建 ${p.name} / ${p.branch}\n`);
      await run(
        "git",
        [
          "clone",
          "--depth",
          "1",
          "--single-branch",
          "--branch",
          p.branch,
          "--",
          p.repo,
          checkout,
        ],
        workDir,
      );
      // Read exact commit from Git without shell interpolation or parsing build output.
      const head = (
        await readFile(path.join(checkout, ".git", "HEAD"), "utf8")
      ).trim();
      let commit;
      if (head.startsWith("ref: ")) {
        const ref = head.slice(5);
        if (!/^refs\/heads\/[a-zA-Z0-9_./-]+$/.test(ref) || ref.includes(".."))
          throw new Error("仓库 HEAD 无效");
        try {
          commit = (
            await readFile(path.join(checkout, ".git", ref), "utf8")
          ).trim();
        } catch {
          commit = (
            await readFile(path.join(checkout, ".git", "packed-refs"), "utf8")
          )
            .split("\n")
            .find((line) => line.endsWith(` ${ref}`))
            ?.split(" ")[0];
        }
      } else commit = head;
      if (!/^[0-9a-f]{40,64}$/.test(commit || ""))
        throw new Error("无法确定构建提交");
      this.db
        .prepare("UPDATE builds SET commitHash=? WHERE id=?")
        .run(commit, build.id);
      log.write(`\n提交：${commit}\n`);
      if (p.installCommand)
        await run("/bin/sh", ["-c", p.installCommand], checkout);
      await run("/bin/sh", ["-c", p.buildCommand], checkout);
      if (controller.signal.aborted) throw new Error("构建已取消");
      const output = path.resolve(checkout, p.outputDir);
      if (
        !(await realpath(output)).startsWith(
          (await realpath(checkout)) + path.sep,
        )
      )
        throw new Error("产物目录超出仓库");
      if (!(await stat(path.join(output, "index.html"))).isFile())
        throw new Error("产物目录缺少 index.html");
      const size = await artifactSize(output);
      await cp(output, this.releaseDir(build.id), {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
      if (controller.signal.aborted) throw new Error("构建已取消");
      this.db
        .prepare(
          "UPDATE builds SET status='succeeded', finishedAt=?,sizeBytes=? WHERE id=?",
        )
        .run(now(), size, build.id);
      if (build.autoPublish) await this.publish(p.id, build.id);
      log.write(
        `\n[${now()}] 构建成功，${size} 字节${build.autoPublish ? `\n发布地址：${this.address(this.project(p.id))}` : "\n产物已保存，等待手动发布"}\n`,
      );
    } catch (error) {
      const status = controller.signal.aborted ? "cancelled" : "failed";
      this.db
        .prepare("UPDATE builds SET status=?,finishedAt=?,error=? WHERE id=?")
        .run(status, now(), String(error.message).slice(0, 2000), build.id);
      log.write(`\n[${now()}] ${status}: ${error.message}\n`);
      // Never remove a directory currently referenced by the active release.
      if (this.project(p.id).currentReleaseId !== build.id)
        await rm(this.releaseDir(build.id), { recursive: true, force: true });
    } finally {
      try {
        await log.close();
      } catch (error) {
        console.error("写入日志失败：", error.message);
      }
      await rm(workDir, { recursive: true, force: true }).catch((error) =>
        console.error("清理工作目录失败：", error.message),
      );
      this.active = null;
    }
  }
  cancel(id) {
    const b = this.build(id);
    if (!running.includes(b.status)) fail("该构建已经结束", 409);
    if (b.status === "queued")
      this.db
        .prepare(
          "UPDATE builds SET status='cancelled',finishedAt=?,error='用户取消构建' WHERE id=?",
        )
        .run(now(), id);
    else this.active?.id === id && this.active.controller.abort();
  }
  async publish(projectId, releaseId, action = "published", expectedCurrent) {
    const p = this.project(projectId),
      b = this.build(releaseId);
    if (p.archived) fail("请先恢复游戏", 409);
    if (b.projectId !== projectId || b.status !== "succeeded")
      fail("该版本没有可发布的成功产物", 409);
    if (
      !(
        await stat(path.join(this.releaseDir(releaseId), "index.html")).catch(
          () => null,
        )
      )?.isFile()
    )
      fail("版本产物丢失，请重新构建", 409);
    if (!this.servers.has(projectId)) await this.listenGame(p);
    transaction(this.db, () => {
      this.build(releaseId); // A release order may have been deleted while awaiting the artifact.
      const fresh = this.project(projectId);
      if (
        expectedCurrent !== undefined &&
        fresh.currentReleaseId !== expectedCurrent
      )
        fail("当前版本已变化，请刷新后重试", 409);
      if (fresh.currentReleaseId === releaseId) return;
      this.db
        .prepare(
          "UPDATE projects SET previousReleaseId=currentReleaseId,currentReleaseId=? WHERE id=?",
        )
        .run(releaseId, projectId);
      this.db
        .prepare("UPDATE builds SET publishedAt=? WHERE id=?")
        .run(now(), releaseId);
      this.event(projectId, action, releaseId, fresh.currentReleaseId);
    });
    return this.project(projectId);
  }
  async rollback(id, expectedCurrent) {
    const p = this.project(id);
    if (!p.previousReleaseId) fail("还没有可以回滚的上一版", 409);
    return this.publish(
      id,
      p.previousReleaseId,
      "rollback",
      expectedCurrent ?? p.currentReleaseId,
    );
  }
  async listenGame(project) {
    if (this.servers.has(project.id)) return;
    const server = createServer(async (req, res) => {
      try {
        const p = this.project(project.id);
        const url = new URL(req.url, "http://game.local");
        if (p.archived || !p.currentReleaseId) {
          res
            .writeHead(503, {
              "Content-Type": "text/plain; charset=utf-8",
              "Cache-Control": "no-store",
            })
            .end("游戏尚未发布");
          return;
        }
        if (
          await serveFile(
            req,
            res,
            this.releaseDir(p.currentReleaseId),
            url.pathname,
            { releaseId: p.currentReleaseId },
          )
        )
          return;
        // Keep content-hashed bundles available to tabs opened before a deployment.
        if (/[-.][a-zA-Z0-9_-]{8,}\.(js|css|woff2?)$/.test(url.pathname)) {
          for (const b of this.db
            .prepare(
              "SELECT id FROM builds WHERE projectId=? AND status='succeeded' ORDER BY createdAt DESC",
            )
            .all(p.id)) {
            if (
              b.id !== p.currentReleaseId &&
              (await serveFile(req, res, this.releaseDir(b.id), url.pathname, {
                releaseId: b.id,
              }))
            )
              return;
          }
        }
        res.writeHead(404).end("Not found");
      } catch (error) {
        if (!res.headersSent) res.writeHead(error.status || 500);
        res.end("无法读取游戏产物");
      }
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(project.port, this.config.host, () => {
        server.removeListener("error", reject);
        resolve();
      });
    });
    server.on("error", (error) =>
      this.portErrors.set(project.id, error.message),
    );
    this.servers.set(project.id, server);
    this.portErrors.delete(project.id);
  }
  async closeGame(id) {
    const server = this.servers.get(id);
    if (!server) return;
    await closeHttpServer(server);
    this.servers.delete(id);
  }
  async close() {
    this.stopping = true;
    this.active?.controller.abort();
    await this.work;
    await Promise.all([...this.servers.keys()].map((id) => this.closeGame(id)));
  }
}
