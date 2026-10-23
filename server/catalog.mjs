import path from "node:path";
import { stat } from "node:fs/promises";
import { httpUrl, iconConfig } from "./android.mjs";
import { transaction } from "./store.mjs";

const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};
const blank = { name: "", url: "", version: "", icon: "", enabled: true };

export class CatalogManager {
  constructor(service) {
    this.service = service;
    this.db = service.db;
  }
  importLegacyApps() {
    if (this.service.setting("catalogLegacyAppsImported")) return;
    transaction(this.db, () => {
      for (const [preferredId, legacyId, name, url] of [
        [
          "lujia-ledger",
          "remote:lujia-ledger",
          "陆家账本",
          "https://money.lucc.site:8888/",
        ],
        [
          "points",
          "remote:points",
          "陆奕凡积分",
          "https://point.lucc.site:8888/",
        ],
      ]) {
        const entries = this.entries();
        const existing = entries.find((e) => e.game.url === url);
        const stamp = new Date().toISOString();
        if (existing) {
          const row = this.db
            .prepare("SELECT config FROM catalog_entries WHERE id=?")
            .get(existing.id);
          const config = {
            ...blank,
            ...(row ? JSON.parse(row.config) : {}),
            orientation: existing.orientation,
            legacyId,
          };
          this.db
            .prepare(
              `INSERT INTO catalog_entries(id,projectId,config,revision,createdAt,updatedAt) VALUES(?,?,?,1,?,?)
            ON CONFLICT(id) DO UPDATE SET config=excluded.config,revision=catalog_entries.revision+1,updatedAt=excluded.updatedAt`,
            )
            .run(
              existing.id,
              existing.projectId,
              JSON.stringify(config),
              stamp,
              stamp,
            );
        } else {
          let id = preferredId,
            suffix = 1;
          while (
            entries.some((e) => e.id === id) ||
            this.db.prepare("SELECT id FROM projects WHERE id=?").get(id)
          )
            id = `${preferredId}-${suffix++}`;
          this.db
            .prepare(
              "INSERT INTO catalog_entries(id,config,revision,createdAt,updatedAt) VALUES(?,?,1,?,?)",
            )
            .run(
              id,
              JSON.stringify({
                ...blank,
                name,
                url,
                orientation: "portrait",
                legacyId,
              }),
              stamp,
              stamp,
            );
        }
      }
      this.db
        .prepare(
          "INSERT INTO settings(key,value) VALUES('catalogLegacyAppsImported','1')",
        )
        .run();
    });
  }
  entries() {
    const saved = this.db
      .prepare("SELECT * FROM catalog_entries ORDER BY createdAt,id")
      .all();
    const overrides = new Map(
      saved.filter((r) => r.projectId).map((r) => [r.projectId, r]),
    );
    const projects = this.db
      .prepare("SELECT * FROM projects WHERE kind='web' ORDER BY createdAt,id")
      .all();
    const resolve = (id, row, project) => {
      const config = row ? JSON.parse(row.config) : { ...blank };
      const orientation =
        config.orientation || (project ? "landscape" : "portrait");
      const icon =
        config.icon || (project ? iconConfig(project.appConfig).icon : "");
      const defaults = {
        name: project?.name || "",
        url: project ? this.service.address(project) : "",
        version: project?.currentReleaseId || "latest",
      };
      return {
        id,
        ...config,
        orientation,
        projectId: project?.id || null,
        projectName: project?.name || "",
        revision: row?.revision || 0,
        available:
          !project || (!project.archived && !!project.currentReleaseId),
        unavailableReason: project?.archived
          ? "项目已归档"
          : project && !project.currentReleaseId
            ? "项目尚未发布"
            : "",
        defaults,
        iconFile: icon,
        game: {
          id,
          name: config.name || defaults.name,
          url: config.url ? this.resolveUrl(config.url) : defaults.url,
          version: config.version || defaults.version,
          icon: icon ? `${this.service.publicOrigin()}/icons/${icon}` : "",
          orientation,
          ...(config.legacyId ? { legacyId: config.legacyId } : {}),
        },
      };
    };
    return [
      ...projects.map((p) => resolve(p.id, overrides.get(p.id), p)),
      ...saved.filter((r) => !r.projectId).map((r) => resolve(r.id, r, null)),
    ];
  }
  published() {
    return this.entries().filter((e) => e.enabled && e.available);
  }
  resolveUrl(value) {
    return value.startsWith("/")
      ? new URL(value, this.service.publicOrigin()).href
      : this.service.gameUrl({ gameUrl: value });
  }
  normalizeUrl(value) {
    if (!value) return "";
    if (
      /[\\\x00-\x20]/.test(value) ||
      value.length > 2048 ||
      value.startsWith("//")
    )
      fail(
        "应用链接应为完整 HTTP/HTTPS 地址或以 / 开头的站内路径，不能包含空格",
      );
    const url = httpUrl(
      value.startsWith("/")
        ? new URL(value, this.service.publicOrigin()).href
        : value,
    );
    const resolved = new URL(this.service.gameUrl({ gameUrl: url }));
    return resolved.origin === this.service.publicOrigin()
      ? resolved.pathname + resolved.search + resolved.hash
      : resolved.href;
  }
  async save(id, input, create = false) {
    if (typeof id !== "string" || !/^[a-zA-Z][a-zA-Z0-9-]{1,39}$/.test(id))
      fail("应用标识应为 2–40 位英文字母、数字或连字符");
    const existing = this.entries().find((e) => e.id === id);
    if (
      create &&
      (existing ||
        this.db.prepare("SELECT id FROM projects WHERE id=?").get(id))
    )
      fail("应用标识已存在，请使用其他标识", 409);
    if (!create && !existing) fail("列表项不存在", 404);
    if (typeof input.enabled !== "boolean") fail("请选择是否在公开列表中显示");
    const config = { enabled: input.enabled };
    config.orientation =
      input.orientation ?? existing?.orientation ?? "portrait";
    if (!["portrait", "landscape", "auto"].includes(config.orientation))
      fail("屏幕方向请选择竖屏、横屏或跟随系统");
    if (existing?.legacyId) config.legacyId = existing.legacyId;
    for (const key of ["name", "url", "version", "icon"]) {
      if (typeof input[key] !== "string") fail(`缺少配置：${key}`);
      config[key] = input[key].trim();
    }
    for (const key of ["name", "version"]) {
      if (config[key].length > 80 || /[\x00-\x1f]/.test(config[key]))
        fail("名称和版本标识不能超过 80 字符或包含控制字符");
    }
    if (!existing?.projectId && (!config.name || !config.url))
      fail("外部应用必须填写名称和应用链接");
    config.url = this.normalizeUrl(config.url);
    config.icon = iconConfig(config).icon;
    if (
      config.icon &&
      !(
        await stat(
          path.join(this.service.config.dataDir, "icons", config.icon),
        ).catch(() => null)
      )?.isFile()
    )
      fail("图标文件不存在，请重新上传");
    transaction(this.db, () => {
      const row = this.db
        .prepare("SELECT revision FROM catalog_entries WHERE id=?")
        .get(id);
      if (
        create &&
        (row || this.db.prepare("SELECT id FROM projects WHERE id=?").get(id))
      )
        fail("应用标识已存在", 409);
      if (!create && input.revision !== (row?.revision || 0))
        fail("此配置已被更新，请刷新列表后重新编辑", 409);
      const stamp = new Date().toISOString();
      this.db
        .prepare(
          `INSERT INTO catalog_entries(id,projectId,config,revision,createdAt,updatedAt) VALUES(?,?,?,1,?,?)
        ON CONFLICT(id) DO UPDATE SET config=excluded.config,revision=catalog_entries.revision+1,updatedAt=excluded.updatedAt`,
        )
        .run(
          id,
          existing?.projectId || null,
          JSON.stringify(config),
          stamp,
          stamp,
        );
      const catalog = this.service.catalog();
      if (
        catalog.games.length > 500 ||
        Buffer.byteLength(JSON.stringify(catalog)) > 512 * 1024
      )
        fail("列表超过 App 的读取上限（500 项、512 KB），请缩短链接或减少条目");
    });
    return this.entries().find((e) => e.id === id);
  }
}
