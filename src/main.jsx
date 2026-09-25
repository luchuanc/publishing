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
  queued: "排队中",
  running: "构建中",
  succeeded: "构建成功",
  failed: "构建失败",
  cancelled: "已取消",
};
const icons = {
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
function ProjectForm({ project, onSave, onClose, busy }) {
  const [form, setForm] = useState(project || blankProject),
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
      title={project ? "游戏设置" : "接入新游戏"}
      subtitle="连接 Git 仓库，配置构建与发布。"
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
          <div className="form-grid">
            {field("name", "游戏名称", "例如：山海弈", {
              required: true,
              maxLength: 80,
            })}
            {field("id", "游戏标识", "例如：zizou", {
              required: true,
              disabled: !!project,
              pattern: "[a-zA-Z][a-zA-Z0-9-]{1,39}",
            })}
          </div>
          {field("repo", "Git 仓库地址", "git@github.com:owner/game.git", {
            required: true,
          })}
          <div className="form-grid">
            {field("branch", "构建分支", "main", { required: true })}
            {field("outputDir", "产物目录", "dist", { required: true })}
          </div>
          {field("installCommand", "依赖安装命令", "npm ci（无依赖可留空）")}
          {field("buildCommand", "构建命令", "npm run build", {
            required: true,
          })}
          <div className="field-note">
            <Terminal size={15} />
            <span>构建在仓库根目录执行，产物目录中需包含 index.html。</span>
          </div>
          {field("publicUrl", "独立域名（可选）", "https://game.example.com")}
          <p className="help">
            留空时自动使用服务器 IP 和游戏端口。自定义域名需先配置反向代理。
          </p>
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
          <button className="primary" disabled={busy}>
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
function BuildForm({ projects, initialId, busy, onSave, onClose }) {
  const [id, setId] = useState(initialId || projects[0]?.id || ""),
    [autoPublish, setAutoPublish] = useState(true),
    [error, setError] = useState("");
  const p = projects.find((p) => p.id === id);
  return (
    <Modal
      title="新增打包"
      subtitle="拉取所选分支的最新代码，创建一个独立版本。"
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          try {
            await onSave(id, autoPublish);
          } catch (e) {
            setError(e.message);
          }
        }}
      >
        <div className="form-body">
          <label>
            选择游戏
            <select value={id} onChange={(e) => setId(e.target.value)} required>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} / {p.id}
                </option>
              ))}
            </select>
          </label>
          {p && (
            <div className="build-summary">
              <span>
                <GitBranch size={15} />
                {p.branch}
              </span>
              <code>{p.repo}</code>
              <div>
                <small>构建命令</small>
                <code>{p.buildCommand}</code>
              </div>
              <div>
                <small>产物目录</small>
                <code>{p.outputDir}/</code>
              </div>
            </div>
          )}
          <label className="checkbox">
            <input
              type="checkbox"
              checked={autoPublish}
              onChange={(e) => setAutoPublish(e.target.checked)}
            />
            <span>
              <strong>构建成功后自动发布</strong>
              <small>关闭后只保存产物，可在版本记录中手动发布。</small>
            </span>
          </label>
          {p?.currentReleaseId && (
            <p className="help">当前线上版本继续提供访问，成功发布后可回滚。</p>
          )}
          {error && (
            <p role="alert" className="error-text">
              {error}
            </p>
          )}
        </div>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary" disabled={busy || !id}>
            <Package size={16} />
            开始打包
          </button>
        </div>
      </form>
    </Modal>
  );
}
function BuildLog({ build, project, onClose, onCancel }) {
  const [text, setText] = useState(""),
    [error, setError] = useState(""),
    [follow, setFollow] = useState(true);
  const logRef = useRef();
  useEffect(() => {
    let stopped = false;
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
    const timer = setInterval(load, 1800);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [build.id]);
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
  return (
    <Modal
      wide
      title="构建日志"
      subtitle={`${project.name} · ${short(build.id)} · ${time(build.createdAt)}`}
      onClose={onClose}
    >
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
        <button onClick={onClose}>关闭日志</button>
      </div>
    </Modal>
  );
}
function App() {
  const [session, setSession] = useState(null),
    [state, setState] = useState(null),
    [page, setPage] = useState("games"),
    [selected, setSelected] = useState(null),
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
    available = projects.filter((p) => !p.archived),
    project = projects.find((p) => p.id === selected);
  const filtered = projects.filter(
    (p) =>
      (filter === "archived" ? p.archived : !p.archived) &&
      (filter !== "live" || p.currentReleaseId) &&
      (filter !== "unpublished" || !p.currentReleaseId) &&
      `${p.name} ${p.id} ${p.repo}`.toLowerCase().includes(query.toLowerCase()),
  );
  const projectBuilds = project
    ? builds.filter((b) => b.projectId === project.id)
    : builds;
  const runningCount = builds.filter(active).length;
  const title = project
    ? project.name
    : {
        games: "游戏项目",
        builds: "构建记录",
        activity: "发布动态",
        settings: "平台设置",
      }[page];
  const confirm = (type, p, build) => setModal({ type, project: p, build });
  const newBuild = (id) => setModal({ type: "build", id });
  function navigate(value) {
    setPage(value);
    setSelected(null);
    setQuery("");
    setMobileNav(false);
  }
  function buildTable(rows) {
    return (
      <div className="table-scroll">
        <table className="build-table">
          <thead>
            <tr>
              <th>构建 / 游戏</th>
              <th>状态</th>
              <th>提交</th>
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
                      onClick={() => setModal({ type: "log", id: b.id })}
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
                    <code>{short(b.commitHash)}</code>
                  </td>
                  <td>
                    {time(b.createdAt)}
                    <small className="cell-sub">{duration(b)}</small>
                  </td>
                  <td>{size(b.sizeBytes)}</td>
                  <td>
                    <div className="row-actions">
                      <button
                        onClick={() => setModal({ type: "log", id: b.id })}
                      >
                        日志
                      </button>
                      {b.status === "succeeded" &&
                        p?.currentReleaseId !== b.id &&
                        !p?.archived && (
                          <button onClick={() => confirm("publish", p, b)}>
                            发布
                          </button>
                        )}
                      {["failed", "cancelled"].includes(b.status) &&
                        !p?.archived && (
                          <button onClick={() => newBuild(p.id)}>重试</button>
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
            <p>从远端仓库打包你的第一个游戏版本。</p>
            <button
              onClick={() => newBuild(project?.id)}
              disabled={!available.length}
            >
              <Plus size={15} />
              新增打包
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
            ["games", LayoutGrid, "游戏项目"],
            ["builds", Package, "构建记录"],
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
              {project && (
                <button className="back-link" onClick={() => setSelected(null)}>
                  <ArrowLeft size={14} />
                  全部游戏
                </button>
              )}
              <div className="eyebrow">
                {project
                  ? "PROJECT OVERVIEW"
                  : {
                      games: "YOUR GAME WORKSPACE",
                      builds: "BUILD HISTORY",
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
                {project
                  ? project.repo
                  : {
                      games: "集中管理单机游戏的构建、发布与版本。",
                      builds: "追踪每次构建，查看日志与产物。",
                      activity: "每一次上线与回滚，都有迹可循。",
                      settings: "查看服务配置与部署信息。",
                    }[page]}
              </p>
            </div>
            <div className="heading-actions">
              {project ? (
                <>
                  <button
                    onClick={() => setModal({ type: "project", project })}
                  >
                    <Settings2 size={16} />
                    游戏设置
                  </button>
                  <button
                    className="primary"
                    onClick={() => newBuild(project.id)}
                    disabled={!!project.archived || active(project.latestBuild)}
                  >
                    <Plus size={17} />
                    新增打包
                  </button>
                </>
              ) : page === "games" ? (
                <>
                  <button onClick={() => setModal({ type: "project" })}>
                    <FolderGit2 size={16} />
                    接入游戏
                  </button>
                  <button
                    className="primary"
                    onClick={() => newBuild()}
                    disabled={!available.length}
                  >
                    <Plus size={17} />
                    新增打包
                  </button>
                </>
              ) : page === "builds" ? (
                <button
                  className="primary"
                  onClick={() => newBuild()}
                  disabled={!available.length}
                >
                  <Plus size={17} />
                  新增打包
                </button>
              ) : null}
            </div>
          </div>
          {!state ? (
            <div className="empty">
              <Loader2 className="spin" />
              <p>正在加载项目…</p>
            </div>
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
                    <span>·</span>端口 {project.port}
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
                    打开游戏
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
                <h2>
                  版本与构建<span>{projectBuilds.length}</span>
                </h2>
                <span className="muted">发布记录保留，支持重复切换</span>
              </div>
              {buildTable(projectBuilds)}
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
                    已上线游戏
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
                    ["all", "全部游戏"],
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
                      <th>游戏项目</th>
                      <th>Git 仓库 / 分支</th>
                      <th>线上版本</th>
                      <th>最新构建</th>
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
                                访问游戏
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
                          {p.latestBuild ? (
                            <>
                              <button
                                className="status-link"
                                onClick={() =>
                                  setModal({
                                    type: "log",
                                    id: p.latestBuild.id,
                                  })
                                }
                              >
                                <Status build={p.latestBuild} />
                              </button>
                              <small className="cell-sub">
                                {time(p.latestBuild.createdAt)}
                              </small>
                            </>
                          ) : (
                            <span className="muted">暂无构建</span>
                          )}
                        </td>
                        <td>
                          <div className="row-actions">
                            <button
                              onClick={() => newBuild(p.id)}
                              disabled={!!p.archived || active(p.latestBuild)}
                            >
                              <Package size={14} />
                              打包
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
                <span>{filtered.length} 个游戏项目</span>
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
              <div className="list-toolbar">
                <h2>
                  全部构建 <span className="muted">{builds.length}</span>
                </h2>
                <label className="search">
                  <Search size={16} />
                  <input
                    aria-label="搜索构建"
                    placeholder="搜索游戏或提交…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
              </div>
              {buildTable(
                builds.filter((b) =>
                  `${projects.find((p) => p.id === b.projectId)?.name} ${b.projectId} ${b.commitHash} ${b.id}`
                    .toLowerCase()
                    .includes(query.toLowerCase()),
                ),
              )}
            </>
          ) : page === "activity" ? (
            <div className="activity-page">
              <Activity events={state.events} projects={projects} />
            </div>
          ) : (
            <div className="settings">
              <section>
                <h2>服务信息</h2>
                <p>修改服务器上的 .env 后重启服务，使配置生效。</p>
                <dl>
                  {[
                    ["管理地址", state.system.publicUrl],
                    ["游戏主机", state.system.gameHost],
                    [
                      "游戏端口范围",
                      `${state.system.portStart} – ${state.system.portEnd}`,
                    ],
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
                  游戏产物由平台直接托管。确保防火墙放行对应端口，或为游戏配置独立域名和
                  HTTPS 反向代理。
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
              "游戏配置已保存",
            )
          }
        />
      )}
      {modal?.type === "build" && (
        <BuildForm
          projects={available}
          initialId={modal.id}
          onClose={() => setModal(null)}
          busy={busy}
          onSave={async (id, autoPublish) => {
            const b = await action(
              () => send(`/projects/${id}/builds`, { autoPublish }),
              "构建已加入队列",
            );
            setModal({ type: "log", id: b.id });
          }}
        />
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
    created: "接入了游戏",
    updated: "更新了构建配置",
    published: "发布了新版本",
    rollback: "回滚了线上版本",
    archived: "归档了游戏",
    restored: "恢复了游戏",
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
                {event.releaseId ? `版本 ${short(event.releaseId)} · ` : ""}
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
