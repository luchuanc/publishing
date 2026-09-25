import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Box,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock3,
  Copy,
  ExternalLink,
  FolderGit2,
  GitBranch,
  History,
  LayoutGrid,
  Loader2,
  LogOut,
  MoreHorizontal,
  Package,
  Plus,
  Radio,
  Rocket,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  Terminal,
  X,
  XCircle,
  Archive,
  Menu,
  Pencil,
  Trash2,
} from "lucide-react";
import "./style.css";

async function api(route, options = {}) {
  const response = await fetch(`/api${route}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Publishing-Request": "1",
      ...options.headers,
    },
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || "请求失败");
    error.status = response.status;
    throw error;
  }
  return data;
}
const send = (route, data = {}, method = "POST") =>
  api(route, { method, body: JSON.stringify(data) });
const time = (value) =>
  value
    ? new Date(value).toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
const short = (value) => value?.slice(0, 7) || "—";
const size = (value) =>
  value ? `${(value / 1024 / 1024).toFixed(1)} MB` : "—";
const active = (build) => ["queued", "running"].includes(build?.status);
const duration = (b) =>
  b.startedAt
    ? `${Math.max(0, Math.round(((b.finishedAt ? new Date(b.finishedAt).getTime() : Date.now()) - new Date(b.startedAt).getTime()) / 1000))}s`
    : "—";
const labels = {
  draft: "未构建",
  queued: "排队中",
  running: "构建中",
  succeeded: "构建成功",
  failed: "构建失败",
  cancelled: "已取消",
};
const icons = {
  draft: Circle,
  queued: Clock3,
  running: Loader2,
  succeeded: CheckCircle2,
  failed: XCircle,
  cancelled: Circle,
};
const blankProject = {
  id: "",
  name: "",
  repo: "",
  branch: "main",
  installCommand: "npm ci",
  buildCommand: "npm run build",
  outputDir: "dist",
  publicUrl: "",
  kind: "web",
  appConfig: {},
};

function Status({ build, live = false }) {
  const key = live ? "live" : build?.status || "pending",
    Icon = live ? Radio : icons[key] || Circle;
  return (
    <span className={`status ${key}`}>
      <Icon size={13} className={key === "running" ? "spin" : ""} />
      {live ? "已上线" : labels[key] || "待发布"}
    </span>
  );
}
function Emblem({ id, large = false }) {
  return (
    <span
      className={`emblem ${large ? "large" : ""} tone-${id === "zizou" ? 1 : id === "backHome" ? 2 : 0}`}
    >
      <Box size={large ? 28 : 21} />
    </span>
  );
}
function Modal({ title, subtitle, children, onClose, wide = false }) {
  const ref = useRef();
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? "wide" : ""}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="modal-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button className="icon-button" onClick={onClose} aria-label="关闭">
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function Login({ onLogin }) {
  const [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="login-page">
      <div className="login-mark">
        <Rocket size={28} />
      </div>
      <h1>
        Launchpad<span>游戏发布工作台</span>
      </h1>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await send("/login", { password });
            onLogin();
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2>登录工作台</h2>
        <p>管理你的游戏，从代码到上线。</p>
        <input
          type="hidden"
          name="username"
          autoComplete="username"
          value="admin"
          readOnly
        />
        <label>
          管理密码
          <input
            autoFocus
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            placeholder="输入管理密码"
          />
        </label>
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        <button className="primary full" disabled={busy}>
          {busy ? (
            <Loader2 className="spin" size={17} />
          ) : (
            <ArrowRight size={17} />
          )}
          登录
        </button>
      </form>
      <small>
        <ShieldCheck size={14} /> 仅管理员可进行构建和发布
      </small>
    </div>
  );
}
function AppConfigFields({ value, onChange, games, origin, onUploading }) {
  const [error, setError] = useState("");
  const update = (key, next) => onChange({ ...value, [key]: next });
  const defaultUrl = value.defaultGameId
    ? `${origin}/${value.defaultGameId}/`
    : "";
  return (
    <fieldset className="app-config">
      <legend>Android 调试 APK</legend>
      <label>
        App 名称
        <input
          value={value.appName || ""}
          placeholder="游戏中心"
          onChange={(e) => update("appName", e.target.value)}
          maxLength={40}
        />
      </label>
      <div className="form-grid">
        <label>
          版本号
          <input
            value={value.versionName || "1.0.0"}
            onChange={(e) => update("versionName", e.target.value)}
            required
          />
        </label>
        <label>
          版本代码
          <input
            type="number"
            min="1"
            max="2100000000"
            value={value.versionCode ?? 1}
            onChange={(e) => update("versionCode", Number(e.target.value))}
            required
          />
        </label>
      </div>
      <label>
        默认游戏
        <select
          value={value.defaultGameId || ""}
          onChange={(e) => update("defaultGameId", e.target.value)}
        >
          <option value="">使用自定义游戏链接</option>
          {games.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {!p.currentReleaseId ? "（未发布）" : ""}
            </option>
          ))}
        </select>
      </label>
      <label>
        游戏链接
        <input
          type="url"
          value={value.gameUrl || ""}
          placeholder={defaultUrl || "https://games.example.com/xiangsu/"}
          onChange={(e) => update("gameUrl", e.target.value)}
          required={!value.defaultGameId}
        />
      </label>
      <p className="help">
        {defaultUrl
          ? `留空自动使用 ${defaultUrl}，也可以填入其他链接。`
          : "填写 App 首次启动打开的地址。"}{" "}
        选中游戏后，App 会记住选择；游戏列表从平台刷新。
      </p>
      <label>
        App 图标（正方形 PNG，最大 2 MB）
        <input
          type="file"
          accept="image/png"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            onUploading(true);
            setError("");
            try {
              if (file.size > 2 * 1024 * 1024)
                throw new Error("图标不能超过 2 MB");
              const data = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(file);
              });
              const result = await send("/icons", { data });
              update("icon", result.icon);
            } catch (error) {
              setError(error.message || "图标上传失败");
            } finally {
              onUploading(false);
              e.target.value = "";
            }
          }}
        />
      </label>
      {value.icon && (
        <div className="icon-preview">
          <img
            src={`/api/icons/${value.icon}`}
            alt="App 图标预览"
            width="64"
            height="64"
          />
          <button type="button" onClick={() => update("icon", "")}>
            恢复默认图标
          </button>
        </div>
      )}
      <p className="help">
        图标、名称、版本和默认游戏在下一次构建时写入
        APK。版本代码增加后可覆盖安装。
      </p>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
    </fieldset>
  );
}
function PublicSettings({ system, onSave, busy }) {
  const [value, setValue] = useState(system.configuredOrigin || "");
  const [error, setError] = useState("");
  return (
    <section>
      <h2>公开访问地址</h2>
      <p>
        游戏、APK 下载与游戏列表共用端口 {system.publicPort}
        。域名的反向代理指向这个端口，并保留完整路径。
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          try {
            await onSave({ publicOrigin: value });
          } catch (e) {
            setError(e.message);
          }
        }}
      >
        <label>
          生产域名（可带端口）
          <input
            type="url"
            value={value}
            placeholder="https://games.xxx.site:8888"
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        <p className="help">
          留空使用服务器地址。保存后已有游戏链接和 APK
          下载链接立即更新，无需重新构建。
        </p>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy}>
          保存访问地址
        </button>
      </form>
      <dl>
        <div>
          <dt>当前资源地址</dt>
          <dd>
            <code>{system.publicOrigin}</code>
          </dd>
        </div>
        <div>
          <dt>公开游戏列表</dt>
          <dd>
            <a href={system.catalogUrl} target="_blank" rel="noreferrer">
              {system.catalogUrl}
            </a>
          </dd>
        </div>
      </dl>
      <p className="help">
        已安装 App
        会通过列表更新游戏地址。更换域名时，请让旧列表入口继续可访问或重定向到新地址；图标和版本变更需重新安装新
        APK。
      </p>
    </section>
  );
}
function ProjectForm({ project, projects, system, onSave, onClose, busy }) {
  const [form, setForm] = useState(project || blankProject),
    [uploading, setUploading] = useState(false),
    [error, setError] = useState("");
  const field = (key, label, placeholder, extra = {}) => (
    <label>
      {label}
      <input
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        placeholder={placeholder}
        {...extra}
      />
    </label>
  );
  return (
    <Modal
      title={project ? "项目设置" : "新建项目"}
      subtitle="配置项目与构建参数，发布单中选择分支并保留每次构建日志。"
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          try {
            await onSave(form);
          } catch (e) {
            setError(e.message);
          }
        }}
      >
        <div className="form-body">
          <label>
            项目类型
            <select
              value={form.kind || "web"}
              disabled={!!project?.latestBuild}
              onChange={(e) => {
                const kind = e.target.value;
                setForm({
                  ...form,
                  kind,
                  installCommand: kind === "android" ? "" : "npm ci",
                  buildCommand:
                    kind === "android"
                      ? "sh ./gradlew --no-daemon --console=plain :app:assembleDebug"
                      : "npm run build",
                  outputDir:
                    kind === "android" ? "app/build/outputs/apk/debug" : "dist",
                  appConfig: {
                    appName: "游戏中心",
                    versionName: "1.0.0",
                    versionCode: 1,
                    defaultGameId:
                      projects.find((p) => p.kind === "web" && !p.archived)
                        ?.id || "",
                  },
                });
              }}
            >
              <option value="web">网页游戏</option>
              <option value="android">Android APK</option>
            </select>
          </label>
          <div className="form-grid">
            {field("name", "项目名称", "例如：山海弈", {
              required: true,
              maxLength: 80,
            })}
            {field("id", "项目标识", "例如：zizou", {
              required: true,
              disabled: !!project,
              pattern: "[a-zA-Z][a-zA-Z0-9-]{1,39}",
            })}
          </div>
          {field("repo", "Git 仓库地址", "git@github.com:owner/game.git", {
            required: true,
          })}
          <div className="form-grid">
            {field("branch", "默认分支", "main", { required: true })}
            {field("outputDir", "产物目录", "dist", { required: true })}
          </div>
          {field("installCommand", "依赖安装命令", "npm ci（无依赖可留空）")}
          {field("buildCommand", "构建命令", "npm run build", {
            required: true,
          })}
          <div className="field-note">
            <Terminal size={15} />
            <span>
              {form.kind === "android"
                ? "构建调试 APK；服务器需要 JDK 17 与 Android SDK。"
                : "产物目录需包含 index.html；游戏资源应支持子目录部署。"}
            </span>
          </div>
          {form.kind === "android" ? (
            <AppConfigFields
              value={form.appConfig || {}}
              onChange={(appConfig) => setForm({ ...form, appConfig })}
              games={projects.filter((p) => p.kind === "web" && !p.archived)}
              origin={system.publicOrigin}
              onUploading={setUploading}
            />
          ) : (
            <p className="help">
              访问地址：{system.publicOrigin}/{form.id || "项目标识"}
              /。统一域名可在平台设置中修改。
            </p>
          )}
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary" disabled={busy || uploading}>
            {busy ? (
              <Loader2 className="spin" size={16} />
            ) : (
              <Check size={16} />
            )}
            保存配置
          </button>
        </div>
      </form>
    </Modal>
  );
}
function ReleaseForm({ projects, release, initialId, busy, onSave, onClose }) {
  const [form, setForm] = useState({
    projectId:
      release?.projectId ||
      initialId ||
      projects.find((p) => !p.archived)?.id ||
      "",
    branch: release?.branch || "",
    title: release?.title || "",
    notes: release?.notes || "",
    autoPublish: release ? !!release.autoPublish : true,
  });
  const [branches, setBranches] = useState([]),
    [loading, setLoading] = useState(true),
    [branchError, setBranchError] = useState(""),
    [error, setError] = useState(""),
    [reload, setReload] = useState(0);
  const p = projects.find((p) => p.id === form.projectId);
  useEffect(() => {
    let stopped = false;
    setBranches([]);
    setLoading(true);
    setBranchError("");
    if (!form.projectId) {
      setLoading(false);
      return;
    }
    api(`/projects/${form.projectId}/branches`)
      .then((result) => {
        if (stopped) return;
        setBranches(result.branches);
        setForm((old) => ({
          ...old,
          branch:
            old.branch ||
            (result.branches.includes(result.defaultBranch)
              ? result.defaultBranch
              : result.branches[0] || ""),
        }));
        if (!result.branches.length)
          setBranchError("远端仓库没有分支，请先提交代码。");
      })
      .catch((e) => {
        if (!stopped) setBranchError(e.message);
      })
      .finally(() => {
        if (!stopped) setLoading(false);
      });
    return () => {
      stopped = true;
    };
  }, [form.projectId, reload]);
  const branchValid = branches.includes(form.branch);
  // Metadata remains editable if an existing order's branch was deleted remotely.
  const unchangedBranch =
    release &&
    release.projectId === form.projectId &&
    release.branch === form.branch;
  return (
    <Modal
      title={release ? "编辑发布单" : "新建发布单"}
      subtitle="选择项目与远端分支。一个发布单可以多次构建，每次日志单独保存。"
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          try {
            await onSave({ ...form, expectedUpdatedAt: release?.updatedAt });
          } catch (e) {
            setError(e.message);
          }
        }}
      >
        <div className="form-body">
          <label>
            发布单名称（可选）
            <input
              maxLength={100}
              value={form.title}
              placeholder="例如：九月内容更新"
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </label>
          <label>
            选择项目
            <select
              required
              value={form.projectId}
              disabled={busy || !!release?.buildCount}
              onChange={(e) =>
                setForm({ ...form, projectId: e.target.value, branch: "" })
              }
            >
              <option value="" disabled>
                请选择项目
              </option>
              {projects
                .filter((p) => !p.archived || p.id === release?.projectId)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} / {p.id}
                    {p.archived ? "（已归档）" : ""}
                  </option>
                ))}
            </select>
          </label>
          <label>
            构建分支
            <select
              required
              value={form.branch}
              disabled={loading || busy}
              onChange={(e) => setForm({ ...form, branch: e.target.value })}
            >
              <option value="" disabled>
                {loading ? "正在读取远端分支…" : "请选择远端分支"}
              </option>
              {!!form.branch && !branchValid && (
                <option value={form.branch} disabled>
                  {form.branch}
                  {loading ? "（读取中）" : "（远端不存在或未读取）"}
                </option>
              )}
              {branches.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </label>
          <div className="branch-feedback">
            <span
              role={branchError ? "alert" : undefined}
              className={branchError ? "error-text" : "muted"}
            >
              {branchError ||
                (loading
                  ? "连接项目仓库…"
                  : `已读取 ${branches.length} 个远端分支`)}
            </span>
            <button
              type="button"
              disabled={loading || busy || !form.projectId}
              onClick={() => setReload((n) => n + 1)}
            >
              <RotateCcw size={13} />
              刷新分支
            </button>
          </div>
          {p && <p className="help repo-preview">{p.repo}</p>}
          <label>
            发布说明
            <textarea
              maxLength={2000}
              rows={3}
              placeholder="记录本次更新内容或发布备注"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={form.autoPublish}
              onChange={(e) =>
                setForm({ ...form, autoPublish: e.target.checked })
              }
            />
            <span>
              <strong>构建成功后自动发布</strong>
              <small>关闭后保留产物，在发布单内手动发布。</small>
            </span>
          </label>
          {!!release?.buildCount && (
            <p className="help">
              分支和发布方式的修改仅用于后续构建；历史提交、日志与产物保持不变。
            </p>
          )}
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button
            className="primary"
            disabled={
              busy ||
              loading ||
              !form.projectId ||
              (!branchValid && !unchangedBranch)
            }
          >
            {busy ? (
              <Loader2 className="spin" size={16} />
            ) : (
              <Check size={16} />
            )}
            {release ? "保存修改" : "创建发布单"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function BuildLog({ build, project, onClose, onCancel, inline = false }) {
  const [text, setText] = useState(""),
    [error, setError] = useState(""),
    [follow, setFollow] = useState(true);
  const logRef = useRef();
  useEffect(() => {
    let stopped = false;
    setText("");
    setError("");
    async function load() {
      try {
        const result = await api(`/builds/${build.id}/log`);
        if (!stopped) {
          setText(result.text);
          setError("");
        }
      } catch (e) {
        if (!stopped) setError(e.message);
      }
    }
    void load();
    const timer = active(build) ? setInterval(load, 1800) : null;
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [build.id, build.status]);
  useEffect(() => {
    if (follow && logRef.current)
      logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [text, follow]);
  function download() {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${project.id}-${build.id}.log`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const content = (
    <>
      <div className="log-toolbar">
        <Status build={build} />
        <code>{short(build.commitHash)}</code>
        <span className="grow" />
        <label className="follow">
          <input
            type="checkbox"
            checked={follow}
            onChange={(e) => setFollow(e.target.checked)}
          />
          跟随日志
        </label>
        <button
          className="icon-button"
          onClick={download}
          title="下载日志"
          aria-label="下载日志"
        >
          <ArrowDownToLine size={17} />
        </button>
      </div>
      <pre ref={logRef} className="log-output">
        {text || "等待构建开始…"}
      </pre>
      {(error || build.error) && (
        <p className="error-text log-error">{error || build.error}</p>
      )}
      <div className="modal-actions">
        {active(build) && (
          <button className="danger-text" onClick={() => onCancel(build.id)}>
            取消构建
          </button>
        )}
        {!inline && <button onClick={onClose}>关闭日志</button>}
      </div>
    </>
  );
  return inline ? (
    <section className="inline-log" aria-label="打包日志">
      {content}
    </section>
  ) : (
    <Modal
      wide
      title="构建日志"
      subtitle={`${project.name} · ${short(build.id)} · ${time(build.createdAt)}`}
      onClose={onClose}
    >
      {content}
    </Modal>
  );
}
function App() {
  const [session, setSession] = useState(null),
    [state, setState] = useState(null),
    [page, setPage] = useState("games"),
    [selected, setSelected] = useState(null),
    [releaseId, setReleaseId] = useState(null),
    [logBuildId, setLogBuildId] = useState(null),
    [releaseProject, setReleaseProject] = useState("all"),
    [releaseStatus, setReleaseStatus] = useState("all"),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [modal, setModal] = useState(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [mobileNav, setMobileNav] = useState(false);
  useEffect(() => {
    api("/session")
      .then((r) => setSession(r.authenticated))
      .catch((e) => {
        setError(e.message);
        setSession(false);
      });
  }, []);
  async function refresh() {
    try {
      const result = await api("/state");
      setState(result);
      setError("");
    } catch (e) {
      setError(e.message);
      if (e.status === 401) setSession(false);
    }
  }
  useEffect(() => {
    if (!session) return;
    void refresh();
    const timer = setInterval(refresh, 2500);
    return () => clearInterval(timer);
  }, [session]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(timer);
  }, [notice]);
  async function action(operation, success, close = true) {
    setBusy(true);
    try {
      const result = await operation();
      if (close) setModal(null);
      await refresh();
      if (success) setNotice(success);
      return result;
    } catch (e) {
      setNotice(e.message);
      throw e;
    } finally {
      setBusy(false);
    }
  }
  const act = (...args) => action(...args).catch(() => {});
  async function copy(value) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice("访问地址已复制");
    } catch {
      setNotice("浏览器不支持复制，请选中地址后手动复制");
    }
  }
  if (session === null)
    return (
      <div className="loading-page">
        <Loader2 size={25} className="spin" />
        正在连接工作台…
      </div>
    );
  if (!session)
    return (
      <Login
        onLogin={() => {
          setSession(true);
          setError("");
        }}
      />
    );
  const projects = state?.projects || [],
    builds = state?.builds || [],
    releases = state?.releases || [],
    release = releases.find((r) => r.id === releaseId),
    releaseBuilds = builds.filter((b) => b.releaseOrderId === releaseId),
    releaseProjectData = projects.find((p) => p.id === release?.projectId),
    logBuild =
      releaseBuilds.find((b) => b.id === logBuildId) || releaseBuilds[0],
    available = projects.filter((p) => !p.archived),
    project = projects.find((p) => p.id === selected);
  const filtered = projects.filter(
    (p) =>
      (filter === "archived" ? p.archived : !p.archived) &&
      (filter !== "live" || p.currentReleaseId) &&
      (filter !== "unpublished" || !p.currentReleaseId) &&
      `${p.name} ${p.id} ${p.repo}`.toLowerCase().includes(query.toLowerCase()),
  );
  const runningCount = builds.filter(active).length;
  const title = release
    ? release.title
    : project
      ? project.name
      : {
          games: "项目管理",
          builds: "发布单",
          activity: "发布动态",
          settings: "平台设置",
        }[page];
  const confirm = (type, p, build) => setModal({ type, project: p, build });
  const newRelease = (id) =>
    setModal({
      type: "release",
      id: id || (releaseProject === "all" ? undefined : releaseProject),
    });
  function openRelease(id) {
    setPage("builds");
    setSelected(null);
    setReleaseId(id);
    setLogBuildId(null);
    setMobileNav(false);
  }
  function viewProjectReleases(id) {
    navigate("builds");
    setReleaseProject(id);
  }
  async function startRelease(id) {
    const b = await act(() => send(`/releases/${id}/builds`), "构建已加入队列");
    if (b) {
      openRelease(id);
      setLogBuildId(b.id);
    }
  }
  const projectBusy = (id) =>
    busy || builds.some((b) => b.projectId === id && active(b));
  const protectedRelease = (r) =>
    builds.some(
      (b) =>
        b.releaseOrderId === r.id &&
        projects.some(
          (p) => p.currentReleaseId === b.id || p.previousReleaseId === b.id,
        ),
    );
  const showLog = (b) =>
    release ? setLogBuildId(b.id) : setModal({ type: "log", id: b.id });
  function navigate(value) {
    setPage(value);
    setSelected(null);
    setReleaseId(null);
    setLogBuildId(null);
    setReleaseProject("all");
    setReleaseStatus("all");
    setQuery("");
    setMobileNav(false);
  }
  function buildTable(rows) {
    return (
      <div className="table-scroll">
        <table className="build-table">
          <thead>
            <tr>
              <th>构建编号</th>
              <th>状态</th>
              <th>分支 / 提交</th>
              <th>时间 / 耗时</th>
              <th>产物</th>
              <th className="right">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => {
              const p = projects.find((p) => p.id === b.projectId);
              return (
                <tr key={b.id}>
                  <td>
                    <button
                      className="text-button dark"
                      onClick={() => showLog(b)}
                    >
                      <Package size={16} />
                      <strong>{short(b.id)}</strong>
                    </button>
                    <small className="cell-sub">
                      {p?.name} · {b.autoPublish ? "自动发布" : "仅打包"}
                    </small>
                  </td>
                  <td>
                    <Status build={b} />
                    {p?.currentReleaseId === b.id && (
                      <span className="current-tag">当前线上</span>
                    )}
                  </td>
                  <td>
                    <span className="branch-name">
                      <GitBranch size={12} />
                      {b.branch}
                    </span>
                    <small className="cell-sub">
                      <code>{short(b.commitHash)}</code>
                    </small>
                  </td>
                  <td>
                    {time(b.createdAt)}
                    <small className="cell-sub">{duration(b)}</small>
                  </td>
                  <td>
                    {size(b.sizeBytes)}
                    {b.appConfig && (
                      <small className="cell-sub">
                        v{b.appConfig.versionName} · {b.appConfig.versionCode}
                      </small>
                    )}
                  </td>
                  <td>
                    <div className="row-actions">
                      <button onClick={() => showLog(b)}>日志</button>
                      {b.downloadUrl && (
                        <a className="text-button" href={b.downloadUrl}>
                          下载 APK
                        </a>
                      )}
                      {b.status === "succeeded" &&
                        p?.currentReleaseId !== b.id &&
                        !p?.archived && (
                          <button onClick={() => confirm("publish", p, b)}>
                            发布
                          </button>
                        )}
                      {["failed", "cancelled"].includes(b.status) &&
                        !p?.archived && (
                          <button
                            disabled={projectBusy(p.id)}
                            onClick={() => startRelease(b.releaseOrderId)}
                          >
                            重新构建
                          </button>
                        )}
                      {active(b) && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            act(
                              () => send(`/builds/${b.id}/cancel`),
                              "已取消构建",
                            )
                          }
                        >
                          取消
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!rows.length && (
          <div className="empty">
            <Package size={32} />
            <h3>还没有构建记录</h3>
            <p>每次构建的提交、产物和日志会保存在这里。</p>
            <button
              onClick={() =>
                release ? startRelease(release.id) : newRelease(project?.id)
              }
              disabled={!available.length}
            >
              <Plus size={15} />
              新建发布单
            </button>
          </div>
        )}
      </div>
    );
  }
  function releaseTable(rows) {
    return (
      <div className="table-scroll">
        <table className="release-table">
          <thead>
            <tr>
              <th>发布单</th>
              <th>项目 / 分支</th>
              <th>最近构建</th>
              <th>创建时间</th>
              <th className="right">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const p = projects.find((p) => p.id === r.projectId);
              const protectedOrder = protectedRelease(r);
              return (
                <tr key={r.id}>
                  <td>
                    <button
                      className="text-button dark release-title"
                      onClick={() => openRelease(r.id)}
                    >
                      <Package size={16} />
                      <strong>{r.title}</strong>
                    </button>
                    <small className="cell-sub">
                      {short(r.id)} · {r.buildCount} 次构建 ·{" "}
                      {r.autoPublish ? "自动发布" : "手动发布"}
                    </small>
                  </td>
                  <td>
                    {p?.name}
                    <small className="cell-sub branch">
                      <GitBranch size={12} />
                      {r.branch}
                    </small>
                  </td>
                  <td>
                    <Status build={r.latestBuild || { status: "draft" }} />
                    {r.latestBuild && (
                      <small className="cell-sub">
                        {time(r.latestBuild.createdAt)}
                      </small>
                    )}
                  </td>
                  <td>{time(r.createdAt)}</td>
                  <td>
                    <div className="row-actions">
                      <button onClick={() => openRelease(r.id)}>详情</button>
                      <button
                        disabled={projectBusy(r.projectId) || !!p?.archived}
                        onClick={() => startRelease(r.id)}
                      >
                        {r.autoPublish ? "构建发布" : "构建"}
                      </button>
                      <button
                        className="icon-button"
                        aria-label={`编辑 ${r.title}`}
                        title="编辑发布单"
                        disabled={busy || active(r.latestBuild)}
                        onClick={() =>
                          setModal({ type: "release", release: r })
                        }
                      >
                        <Pencil size={15} />
                      </button>
                      <span
                        title={
                          protectedOrder
                            ? "包含当前线上版本或上一版，暂不能删除"
                            : active(r.latestBuild)
                              ? "请等待构建结束"
                              : "删除发布单"
                        }
                      >
                        <button
                          className="icon-button danger-text"
                          aria-label={`删除 ${r.title}`}
                          disabled={
                            busy || active(r.latestBuild) || protectedOrder
                          }
                          onClick={() =>
                            setModal({ type: "delete-release", release: r })
                          }
                        >
                          <Trash2 size={15} />
                        </button>
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!rows.length && (
          <div className="empty">
            <Package size={30} />
            <h3>暂无匹配的发布单</h3>
            <p>新建发布单，选择项目与分支后开始构建。</p>
            <button
              disabled={!available.length}
              onClick={() =>
                newRelease(
                  releaseProject === "all" ? undefined : releaseProject,
                )
              }
            >
              <Plus size={15} />
              新建发布单
            </button>
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? "open" : ""}`}>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate("games");
          }}
        >
          <span className="brand-icon">
            <Rocket size={20} />
          </span>
          Launchpad<span className="brand-dot">•</span>
        </a>
        <div className="workspace">
          <span className="workspace-avatar">L</span>
          <div>
            <strong>游戏工作空间</strong>
            <small>个人项目</small>
          </div>
          <ChevronDown size={14} />
        </div>
        <p className="nav-label">工作台</p>
        <nav>
          {[
            ["games", LayoutGrid, "项目管理"],
            ["builds", Package, "发布单"],
            ["activity", History, "发布动态"],
          ].map(([key, Icon, label]) => (
            <button
              key={key}
              className={page === key ? "selected" : ""}
              onClick={() => navigate(key)}
            >
              <Icon size={18} />
              {label}
              {key === "games" && (
                <span className="nav-count">{available.length}</span>
              )}
              {key === "builds" && runningCount > 0 && (
                <span className="nav-count">{runningCount}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="service-status">
            <span className={error ? "dot warning" : "dot"} />
            <span>{error ? "连接异常" : "发布服务运行中"}</span>
          </div>
          <button
            className={page === "settings" ? "selected" : ""}
            onClick={() => navigate("settings")}
          >
            <Settings2 size={18} />
            平台设置
          </button>
          <div className="user">
            <span className="user-avatar">L</span>
            <div>
              <strong>管理员</strong>
              <small>工作空间所有者</small>
            </div>
            <button
              className="icon-button"
              aria-label="退出登录"
              title="退出登录"
              onClick={() =>
                act(async () => {
                  await send("/logout");
                  setSession(false);
                  setState(null);
                }, "")
              }
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <button
            className="icon-button mobile-only"
            onClick={() => setMobileNav(!mobileNav)}
            aria-label="切换导航"
          >
            <Menu size={20} />
          </button>
          <div className="breadcrumb">
            <span>工作空间</span>
            <ChevronRight size={14} />
            <strong>{title}</strong>
          </div>
          <div className="topbar-right">
            <span className="environment">
              <span className="dot" />
              生产环境
            </span>
            <span className="top-avatar">L</span>
          </div>
        </header>
        <main>
          {error && (
            <div className="error-banner" role="alert">
              <XCircle size={16} />
              {error}
              <button onClick={refresh}>重试</button>
            </div>
          )}
          <div className="page-heading">
            <div>
              {(project || release) && (
                <button
                  className="back-link"
                  onClick={() =>
                    release ? setReleaseId(null) : setSelected(null)
                  }
                >
                  <ArrowLeft size={14} />
                  {release ? "全部发布单" : "全部项目"}
                </button>
              )}
              <div className="eyebrow">
                {project
                  ? "PROJECT OVERVIEW"
                  : {
                      games: "YOUR GAME WORKSPACE",
                      builds: "RELEASE ORDERS",
                      activity: "RELEASE ACTIVITY",
                      settings: "WORKSPACE SETTINGS",
                    }[page]}
              </div>
              <h1>
                {title}
                {page === "games" && !project && (
                  <span className="heading-count">{available.length}</span>
                )}
              </h1>
              <p>
                {release
                  ? `${releaseProjectData?.name} · ${release.branch}`
                  : project
                    ? project.repo
                    : {
                        games: "管理游戏仓库、构建配置和访问地址。",
                        builds: "选择项目与分支，多次构建发布，保留每次日志。",
                        activity: "每一次上线与回滚，都有迹可循。",
                        settings: "查看服务配置与部署信息。",
                      }[page]}
              </p>
            </div>
            <div className="heading-actions">
              {release ? (
                <>
                  <button
                    disabled={busy || active(release.latestBuild)}
                    onClick={() => setModal({ type: "release", release })}
                  >
                    <Pencil size={15} />
                    编辑发布单
                  </button>
                  <button
                    className="primary"
                    disabled={
                      projectBusy(release.projectId) ||
                      !!releaseProjectData?.archived
                    }
                    onClick={() => startRelease(release.id)}
                  >
                    <Package size={16} />
                    {release.autoPublish ? "构建并发布" : "开始构建"}
                  </button>
                </>
              ) : project ? (
                <>
                  <button
                    onClick={() => setModal({ type: "project", project })}
                  >
                    <Settings2 size={16} />
                    项目设置
                  </button>
                  <button
                    className="primary"
                    onClick={() => viewProjectReleases(project.id)}
                  >
                    <Package size={17} />
                    查看发布单
                  </button>
                </>
              ) : page === "games" ? (
                <button
                  className="primary"
                  onClick={() => setModal({ type: "project" })}
                >
                  <FolderGit2 size={16} />
                  新建项目
                </button>
              ) : page === "builds" ? (
                <button
                  className="primary"
                  onClick={() => newRelease()}
                  disabled={!available.length}
                >
                  <Plus size={17} />
                  新建发布单
                </button>
              ) : null}
            </div>
          </div>
          {!state ? (
            <div className="empty">
              <Loader2 className="spin" />
              <p>正在加载项目…</p>
            </div>
          ) : release ? (
            <>
              <div className="release-summary">
                <div>
                  <span className="section-label">所属项目</span>
                  <button
                    className="text-button dark"
                    onClick={() => {
                      navigate("games");
                      setSelected(release.projectId);
                    }}
                  >
                    <FolderGit2 size={16} />
                    {releaseProjectData?.name}
                    <ArrowUpRight size={14} />
                  </button>
                </div>
                <div>
                  <span className="section-label">下次构建分支</span>
                  <span className="branch-name">
                    <GitBranch size={15} />
                    {release.branch}
                  </span>
                </div>
                <div>
                  <span className="section-label">发布方式</span>
                  <p>
                    {release.autoPublish
                      ? "构建成功后自动发布"
                      : "构建后手动发布"}
                  </p>
                </div>
                <div>
                  <span className="section-label">创建时间</span>
                  <p>{time(release.createdAt)}</p>
                </div>
              </div>
              {release.notes && (
                <p className="release-notes">{release.notes}</p>
              )}
              {!!releaseProjectData?.archived && (
                <div className="error-banner">
                  所属项目已归档，恢复项目后可继续构建发布。
                </div>
              )}
              <div className="release-panel">
                <div>
                  <span className="section-label">项目访问地址</span>
                  {releaseProjectData?.currentReleaseId &&
                  !releaseProjectData.archived ? (
                    <div className="url-line">
                      <a
                        href={releaseProjectData.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {releaseProjectData.url}
                        <ArrowUpRight size={14} />
                      </a>
                      <button
                        className="icon-button"
                        aria-label="复制访问地址"
                        onClick={() => copy(releaseProjectData.url)}
                      >
                        <Copy size={14} />
                      </button>
                    </div>
                  ) : (
                    <p className="muted">首次发布成功后可访问</p>
                  )}
                </div>
                <div>
                  <span className="section-label">项目当前线上版本</span>
                  <p>
                    <code>{short(releaseProjectData?.currentReleaseId)}</code> ·{" "}
                    {releaseProjectData?.currentRelease?.branch || "—"}
                  </p>
                </div>
                <button
                  disabled={
                    !releaseProjectData?.previousReleaseId ||
                    !!releaseProjectData?.archived ||
                    busy
                  }
                  onClick={() => confirm("rollback", releaseProjectData)}
                >
                  <RotateCcw size={15} />
                  回滚上一版
                </button>
              </div>
              <div className="section-heading">
                <h2>打包日志</h2>
                {releaseBuilds.length > 0 && (
                  <label className="log-selector">
                    选择构建记录
                    <select
                      aria-label="选择构建记录"
                      value={logBuild?.id || ""}
                      onChange={(e) => setLogBuildId(e.target.value)}
                    >
                      {releaseBuilds.map((b, index) => (
                        <option key={b.id} value={b.id}>
                          第 {releaseBuilds.length - index} 次 · {b.branch} ·{" "}
                          {short(b.id)} · {labels[b.status]}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
              {logBuild ? (
                <BuildLog
                  inline
                  build={logBuild}
                  project={releaseProjectData}
                  onCancel={(id) =>
                    act(() => send(`/builds/${id}/cancel`), "已请求取消", false)
                  }
                />
              ) : (
                <div className="empty log-empty">
                  <Terminal size={30} />
                  <h3>尚未开始构建</h3>
                  <p>
                    点击“{release.autoPublish ? "构建并发布" : "开始构建"}
                    ”后，这里会显示实时打包日志。
                  </p>
                </div>
              )}
              <div className="section-heading build-history-heading">
                <h2>
                  构建记录 <span>{releaseBuilds.length} 次</span>
                </h2>
                <span className="muted">
                  每次构建独立保存，点击日志可切换查看
                </span>
              </div>
              {releaseBuilds.length ? (
                buildTable(releaseBuilds)
              ) : (
                <p className="muted">暂无构建记录</p>
              )}
              <div className="archive-area">
                <p>
                  {protectedRelease(release)
                    ? "包含当前线上版本或上一版，暂不能删除此发布单。"
                    : "删除发布单会从管理列表中移除相关构建记录。"}
                </p>
                <button
                  className="danger-text"
                  disabled={
                    busy ||
                    active(release.latestBuild) ||
                    protectedRelease(release)
                  }
                  onClick={() => setModal({ type: "delete-release", release })}
                >
                  <Trash2 size={15} />
                  删除发布单
                </button>
              </div>
            </>
          ) : project ? (
            <>
              <div className="project-summary">
                <Emblem id={project.id} large />
                <div className="grow">
                  <div className="inline">
                    <h2>{project.name}</h2>
                    <Status live={!!project.currentReleaseId} />
                    {!!project.archived && (
                      <span className="current-tag">已归档</span>
                    )}
                  </div>
                  <p>
                    <GitBranch size={14} />
                    {project.branch}
                    <span>·</span>
                    {project.kind === "android"
                      ? "Android APK"
                      : `/${project.id}/`}
                    <span>·</span>
                    {project.outputDir}/
                  </p>
                </div>
                {project.currentReleaseId && !project.archived && (
                  <a
                    className="button"
                    href={project.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {project.kind === "android" ? "下载 APK" : "打开游戏"}
                    <ExternalLink size={16} />
                  </a>
                )}
              </div>
              {project.servingError && (
                <div className="error-banner">
                  游戏端口异常：{project.servingError}
                </div>
              )}
              <div className="release-panel">
                <div>
                  <span className="section-label">当前访问地址</span>
                  {project.currentReleaseId && !project.archived ? (
                    <div className="url-line">
                      <a href={project.url} target="_blank" rel="noreferrer">
                        {project.url}
                      </a>
                      <button
                        className="icon-button"
                        onClick={() => copy(project.url)}
                        aria-label="复制访问地址"
                      >
                        <Copy size={15} />
                      </button>
                    </div>
                  ) : (
                    <p className="muted">
                      {project.archived
                        ? "游戏已归档，访问已停用"
                        : "首次发布成功后可访问"}
                    </p>
                  )}
                </div>
                <div>
                  <span className="section-label">线上版本</span>
                  <p>
                    <code>{short(project.currentReleaseId)}</code>
                    <span className="muted">
                      {" "}
                      · {time(project.currentRelease?.publishedAt)}
                    </span>
                  </p>
                </div>
                <button
                  disabled={!project.previousReleaseId || !!project.archived}
                  onClick={() => confirm("rollback", project)}
                >
                  <RotateCcw size={16} />
                  回滚上一版
                </button>
              </div>
              <div className="section-heading">
                <h2>项目配置</h2>
                <button onClick={() => viewProjectReleases(project.id)}>
                  查看此项目发布单 <ArrowRight size={14} />
                </button>
              </div>
              <dl className="project-config">
                <div>
                  <dt>依赖安装</dt>
                  <dd>
                    <code>{project.installCommand || "无需安装"}</code>
                  </dd>
                </div>
                <div>
                  <dt>构建命令</dt>
                  <dd>
                    <code>{project.buildCommand}</code>
                  </dd>
                </div>
                <div>
                  <dt>产物目录</dt>
                  <dd>
                    <code>{project.outputDir}</code>
                  </dd>
                </div>
              </dl>
              <div className="archive-area">
                <p>
                  {project.archived
                    ? "恢复游戏后，原版本将重新提供访问。"
                    : "归档后将停止游戏访问，保留配置与版本记录。"}
                </p>
                <button
                  onClick={() =>
                    confirm(project.archived ? "restore" : "archive", project)
                  }
                >
                  <Archive size={15} />
                  {project.archived ? "恢复游戏" : "归档游戏"}
                </button>
              </div>
            </>
          ) : page === "games" ? (
            <>
              <div className="metrics">
                <div>
                  <span>
                    已发布项目
                    <Radio size={15} />
                  </span>
                  <strong>
                    {available.filter((p) => p.currentReleaseId).length}
                    <small>/ {available.length}</small>
                  </strong>
                  <p>固定地址，随时游玩</p>
                </div>
                <div>
                  <span>
                    正在构建
                    <Package size={15} />
                  </span>
                  <strong>{runningCount.toString().padStart(2, "0")}</strong>
                  <p>{runningCount ? "队列依次执行中" : "当前没有排队任务"}</p>
                </div>
                <div>
                  <span>
                    成功构建
                    <CheckCircle2 size={15} />
                  </span>
                  <strong>
                    {builds
                      .filter((b) => b.status === "succeeded")
                      .length.toString()
                      .padStart(2, "0")}
                  </strong>
                  <p>已保存的可发布版本</p>
                </div>
                <div>
                  <span>
                    最近发布
                    <Clock3 size={15} />
                  </span>
                  <strong className="date-metric">
                    {time(
                      state.events.find((e) =>
                        ["published", "rollback"].includes(e.action),
                      )?.createdAt,
                    )}
                  </strong>
                  <p>包含发布与版本回滚</p>
                </div>
              </div>
              <div className="list-toolbar">
                <div className="tabs">
                  {[
                    ["all", "全部项目"],
                    ["live", "已上线"],
                    ["unpublished", "待发布"],
                    ["archived", "已归档"],
                  ].map(([key, label]) => (
                    <button
                      key={key}
                      className={filter === key ? "active" : ""}
                      onClick={() => setFilter(key)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <label className="search">
                  <Search size={16} />
                  <input
                    aria-label="搜索游戏"
                    placeholder="搜索游戏、仓库…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  {query && (
                    <button
                      className="icon-button"
                      aria-label="清除搜索"
                      onClick={() => setQuery("")}
                    >
                      <X size={14} />
                    </button>
                  )}
                </label>
              </div>
              <div className="table-scroll">
                <table className="games-table">
                  <thead>
                    <tr>
                      <th>项目</th>
                      <th>Git 仓库 / 分支</th>
                      <th>线上版本</th>
                      <th>发布单</th>
                      <th className="right">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <button
                            className="game-identity"
                            onClick={() => setSelected(p.id)}
                          >
                            <Emblem id={p.id} />
                            <span>
                              <strong>{p.name}</strong>
                              <small>{p.id}</small>
                            </span>
                          </button>
                        </td>
                        <td>
                          <span className="repo-name">
                            {p.repo
                              .replace(
                                /^git@github.com:|^https:\/\/github.com\//,
                                "",
                              )
                              .replace(/\.git$/, "")}
                          </span>
                          <small className="cell-sub branch">
                            <GitBranch size={12} />
                            {p.branch}
                          </small>
                        </td>
                        <td>
                          <Status live={!!p.currentReleaseId && !p.archived} />
                          {p.currentReleaseId && !p.archived ? (
                            <div className="table-url">
                              <a href={p.url} target="_blank" rel="noreferrer">
                                {p.kind === "android" ? "下载 APK" : "访问游戏"}
                                <ArrowUpRight size={12} />
                              </a>
                              <button
                                className="icon-button"
                                onClick={() => copy(p.url)}
                                aria-label={`复制 ${p.name} 地址`}
                              >
                                <Copy size={12} />
                              </button>
                            </div>
                          ) : (
                            <small className="cell-sub">
                              {p.archived ? "已归档" : "尚未发布版本"}
                            </small>
                          )}
                        </td>
                        <td>
                          <button
                            className="text-button"
                            onClick={() => viewProjectReleases(p.id)}
                          >
                            {
                              releases.filter((r) => r.projectId === p.id)
                                .length
                            }{" "}
                            个发布单 <ChevronRight size={12} />
                          </button>
                        </td>
                        <td>
                          <div className="row-actions">
                            <button
                              onClick={() =>
                                setModal({ type: "project", project: p })
                              }
                            >
                              <Settings2 size={14} />
                              配置
                            </button>
                            <button
                              className="icon-button"
                              aria-label={`${p.name} 项目详情`}
                              title="项目详情"
                              onClick={() => setSelected(p.id)}
                            >
                              <MoreHorizontal size={19} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!filtered.length && (
                  <div className="empty">
                    <Search size={28} />
                    <h3>没有匹配的游戏</h3>
                    <p>调整筛选条件，或接入一个新仓库。</p>
                  </div>
                )}
              </div>
              <div className="list-footer">
                <span>{filtered.length} 个项目</span>
                <span>
                  <span className="dot" />每 2.5 秒自动更新
                </span>
              </div>
              <div className="lower-grid">
                <section>
                  <div className="section-heading">
                    <h2>最近动态</h2>
                    <button
                      className="text-button"
                      onClick={() => navigate("activity")}
                    >
                      全部动态
                      <ArrowRight size={14} />
                    </button>
                  </div>
                  <Activity
                    events={state.events.slice(0, 4)}
                    projects={projects}
                  />
                </section>
                <section className="workflow">
                  <span className="section-label">发布流程</span>
                  <h2>从提交到上线</h2>
                  <div className="workflow-steps">
                    <span>
                      <FolderGit2 size={19} />
                      拉取代码
                    </span>
                    <ChevronRight size={15} />
                    <span>
                      <Package size={19} />
                      构建产物
                    </span>
                    <ChevronRight size={15} />
                    <span>
                      <Rocket size={19} />
                      发布游戏
                    </span>
                  </div>
                  <p>每次构建独立保存。发布失败时，当前线上版本继续运行。</p>
                  <button
                    className="text-button"
                    onClick={() => navigate("settings")}
                  >
                    查看部署配置
                    <ArrowUpRight size={14} />
                  </button>
                </section>
              </div>
            </>
          ) : page === "builds" ? (
            <>
              <div className="list-toolbar release-filters">
                <div className="filter-fields">
                  <label>
                    项目
                    <select
                      aria-label="筛选项目"
                      value={releaseProject}
                      onChange={(e) => setReleaseProject(e.target.value)}
                    >
                      <option value="all">全部项目</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    最近状态
                    <select
                      aria-label="筛选发布单状态"
                      value={releaseStatus}
                      onChange={(e) => setReleaseStatus(e.target.value)}
                    >
                      <option value="all">全部状态</option>
                      {Object.entries(labels).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="search">
                  <Search size={16} />
                  <input
                    aria-label="搜索发布单"
                    placeholder="搜索发布单、项目或分支…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
              </div>
              {releaseTable(
                releases.filter(
                  (r) =>
                    (releaseProject === "all" ||
                      r.projectId === releaseProject) &&
                    (releaseStatus === "all" ||
                      (r.latestBuild?.status || "draft") === releaseStatus) &&
                    `${r.title} ${r.id} ${r.branch} ${projects.find((p) => p.id === r.projectId)?.name}`
                      .toLowerCase()
                      .includes(query.toLowerCase()),
                ),
              )}
              <div className="list-footer">
                <span>共 {releases.length} 个发布单</span>
                <span>构建状态自动更新</span>
              </div>
            </>
          ) : page === "activity" ? (
            <div className="activity-page">
              <Activity events={state.events} projects={projects} />
            </div>
          ) : (
            <div className="settings">
              <PublicSettings
                system={state.system}
                busy={busy}
                onSave={(form) =>
                  action(
                    () => send("/settings", form, "PATCH"),
                    "公开访问地址已更新",
                    false,
                  )
                }
              />
              <section>
                <h2>服务信息</h2>
                <p>修改服务器上的 .env 后重启服务，使配置生效。</p>
                <dl>
                  {[
                    ["管理地址", state.system.publicUrl],
                    ["游戏主机", state.system.gameHost],
                    ["公开资源端口", state.system.publicPort],
                    ["Node.js", state.system.node],
                    ["构建并发", "1（任务顺序执行）"],
                    ["访问控制", "管理员登录 · 12 小时会话"],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>
                        <code>{v}</code>
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
              <section>
                <h2>Linux 部署</h2>
                <p>
                  所有游戏和 APK 共用公开资源端口，使用子目录区分。HTTPS
                  反向代理保留原始路径即可。管理后台使用独立端口。
                </p>
                <div className="setting-note">
                  <ShieldCheck size={20} />
                  <div>
                    <strong>私有仓库访问</strong>
                    <p>
                      在服务器配置可读取游戏仓库的 SSH 密钥与 GitHub
                      known_hosts。构建日志会保留拉取失败原因。
                    </p>
                  </div>
                </div>
                <div className="setting-note">
                  <History size={20} />
                  <div>
                    <strong>版本与存档</strong>
                    <p>
                      回滚仅切换游戏文件，玩家存档保留在浏览器。游戏更新需要维持存档格式兼容。
                    </p>
                  </div>
                </div>
                <a
                  className="text-button"
                  href="https://github.com/luchuanc/publishing#readme"
                  target="_blank"
                  rel="noreferrer"
                >
                  部署文档
                  <ExternalLink size={15} />
                </a>
              </section>
            </div>
          )}
          <footer className="page-footer">
            <span>
              Launchpad <span className="muted">/</span> 单机游戏发布平台
            </span>
            <span>Build. Release. Play.</span>
          </footer>
        </main>
      </div>
      {notice && (
        <div className="toast" role="status">
          <CheckCircle2 size={17} />
          {notice}
        </div>
      )}
      {modal?.type === "project" && (
        <ProjectForm
          projects={projects}
          system={state.system}
          project={modal.project}
          onClose={() => setModal(null)}
          busy={busy}
          onSave={(form) =>
            action(
              () =>
                send(
                  modal.project ? `/projects/${modal.project.id}` : "/projects",
                  form,
                  modal.project ? "PATCH" : "POST",
                ),
              "项目配置已保存",
            )
          }
        />
      )}
      {modal?.type === "release" && (
        <ReleaseForm
          projects={projects}
          release={modal.release}
          initialId={modal.id}
          onClose={() => setModal(null)}
          busy={busy}
          onSave={async (form) => {
            const result = await action(
              () =>
                send(
                  modal.release ? `/releases/${modal.release.id}` : "/releases",
                  form,
                  modal.release ? "PATCH" : "POST",
                ),
              modal.release ? "发布单已更新" : "发布单已创建",
            );
            openRelease(result.id);
          }}
        />
      )}
      {modal?.type === "delete-release" && (
        <Modal title="删除发布单" onClose={() => setModal(null)}>
          <div className="form-body">
            <p>{modal.release.title}</p>
            <p className="muted">
              删除后，此发布单及其构建记录将从管理列表中移除，无法恢复。
            </p>
          </div>
          <div className="modal-actions">
            <button onClick={() => setModal(null)}>取消</button>
            <button
              className="danger-text"
              disabled={busy}
              onClick={async () => {
                const result = await act(
                  () => send(`/releases/${modal.release.id}`, {}, "DELETE"),
                  "发布单已删除",
                );
                if (result && releaseId === modal.release.id)
                  setReleaseId(null);
              }}
            >
              <Trash2 size={15} />
              确认删除
            </button>
          </div>
        </Modal>
      )}
      {modal?.type === "log" && builds.find((b) => b.id === modal.id) && (
        <BuildLog
          build={builds.find((b) => b.id === modal.id)}
          project={projects.find(
            (p) => p.id === builds.find((b) => b.id === modal.id).projectId,
          )}
          onClose={() => setModal(null)}
          onCancel={(id) =>
            act(() => send(`/builds/${id}/cancel`), "已请求取消", false)
          }
        />
      )}
      {["publish", "rollback", "archive", "restore"].includes(modal?.type) && (
        <Modal
          title={
            {
              publish: "发布此版本",
              rollback: "回滚上一版",
              archive: "归档游戏",
              restore: "恢复游戏",
            }[modal.type]
          }
          onClose={() => setModal(null)}
        >
          <div className="form-body">
            <p>{modal.project.name}</p>
            <p className="muted">
              {
                {
                  publish: `将线上版本切换为 ${short(modal.build?.id)}，原版本可随时回滚。`,
                  rollback: `将从 ${short(modal.project.currentReleaseId)} 切换到 ${short(modal.project.previousReleaseId)}，访问地址保持不变。`,
                  archive: "游戏将停止访问，配置和历史版本会保留。",
                  restore: "恢复后将重新开放已有线上版本的访问。",
                }[modal.type]
              }
            </p>
          </div>
          <div className="modal-actions">
            <button onClick={() => setModal(null)}>取消</button>
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                act(
                  () =>
                    send(
                      `/projects/${modal.project.id}/${["archive", "restore"].includes(modal.type) ? "archive" : modal.type}`,
                      {
                        releaseId: modal.build?.id,
                        expectedCurrent: modal.project.currentReleaseId,
                        archived: modal.type === "archive",
                      },
                    ),
                  "操作已完成",
                )
              }
            >
              {busy && <Loader2 className="spin" size={15} />}确认
              {modal.type === "rollback"
                ? "回滚"
                : modal.type === "publish"
                  ? "发布"
                  : modal.type === "archive"
                    ? "归档"
                    : "恢复"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function Activity({ events, projects }) {
  const verbs = {
    created: "接入了项目",
    updated: "更新了构建配置",
    published: "发布了新版本",
    rollback: "回滚了线上版本",
    archived: "归档了游戏",
    restored: "恢复了游戏",
    release_created: "创建了发布单",
    release_updated: "编辑了发布单",
    release_deleted: "删除了发布单",
  };
  return (
    <div className="activity-list">
      {events.length ? (
        events.map((event) => (
          <div className="activity-item" key={event.id}>
            <span
              className={`activity-icon ${event.action === "published" ? "success" : ""}`}
            >
              {event.action === "rollback" ? (
                <RotateCcw size={15} />
              ) : event.action === "published" ? (
                <Rocket size={15} />
              ) : (
                <FolderGit2 size={15} />
              )}
            </span>
            <div>
              <p>
                <strong>
                  {projects.find((p) => p.id === event.projectId)?.name ||
                    event.projectId}
                </strong>{" "}
                {verbs[event.action] || event.action}
              </p>
              <small>
                {event.releaseId
                  ? `${event.action.startsWith("release_") ? "发布单" : "版本"} ${short(event.releaseId)} · `
                  : ""}
                {time(event.createdAt)}
              </small>
            </div>
          </div>
        ))
      ) : (
        <div className="empty small">
          <History size={25} />
          <p>还没有发布动态</p>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
