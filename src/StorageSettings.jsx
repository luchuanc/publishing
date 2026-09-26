import React, { useEffect, useState } from "react";
import { HardDrive, Loader2, RotateCcw, Trash2 } from "lucide-react";

const bytes = (value = 0) => {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
};
const stamp = (value) => new Date(value).toLocaleString("zh-CN");

export default function StorageSettings({ api, onChanged }) {
  const [data, setData] = useState(null),
    [loading, setLoading] = useState(true),
    [cleaning, setCleaning] = useState(false),
    [confirming, setConfirming] = useState(false),
    [error, setError] = useState("");
  async function load() {
    setLoading(true);
    setError("");
    setConfirming(false);
    try {
      setData(await api("/storage"));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function clean() {
    setCleaning(true);
    setError("");
    try {
      await api("/storage/cleanup", { method: "POST", body: "{}" });
      await load();
      await onChanged();
    } catch (e) {
      setError(e.message);
    } finally {
      setCleaning(false);
    }
  }
  const ready = data?.cleanup.artifacts.filter((b) => b.ready) || [];
  const logs = data?.cleanup.logs || [];
  const count = ready.length + logs.length;
  const grace = data?.cleanup.artifacts.filter((b) => !b.ready) || [];
  return (
    <section className="storage-settings" aria-label="存储与清理">
      <div className="storage-heading">
        <h2>
          <HardDrive size={20} /> 存储与清理
        </h2>
        <button onClick={load} disabled={loading || cleaning}>
          {loading ? (
            <Loader2 size={15} className="spin" />
          ) : (
            <RotateCcw size={15} />
          )}{" "}
          刷新占用
        </button>
      </div>
      <p>
        构建日志保留 30 天，每个项目保留最近 10
        个成功版本，当前线上版本和上一版额外保护。
      </p>
      <p>
        超出保留范围的产物先保留 7
        天，供已打开的游戏加载旧资源；宽限期结束后清理。启动时和每小时自动检查。
      </p>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      {!data && loading && <p role="status">正在统计磁盘占用…</p>}
      {data && (
        <>
          <div className="storage-metrics">
            <div>
              <span>平台数据</span>
              <strong>{bytes(data.usage.total)}</strong>
            </div>
            <div>
              <span>可清理空间</span>
              <strong>{bytes(data.cleanup.reclaimableBytes)}</strong>
            </div>
            <div>
              <span>磁盘可用 / 总容量</span>
              <strong>
                {bytes(data.disk.availableBytes)} /{" "}
                {bytes(data.disk.totalBytes)}
              </strong>
            </div>
          </div>
          <meter
            aria-label="服务器磁盘已用空间"
            min="0"
            max={data.disk.totalBytes}
            value={data.disk.usedBytes}
          />
          <p className="help">
            磁盘已用 {bytes(data.disk.usedBytes)}
            ，包含服务器上的其他数据。平台统计不含外部备份、npm / Gradle
            缓存；图标、数据库和服务运行日志仅统计，不自动删除。
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>项目</th>
                  <th>保留产物</th>
                  <th>构建日志</th>
                  <th>临时构建</th>
                  <th>成功版本</th>
                </tr>
              </thead>
              <tbody>
                {data.projects.map((p) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td>{bytes(p.artifacts)}</td>
                    <td>{bytes(p.logs)}</td>
                    <td>{bytes(p.work)}</td>
                    <td>{p.retainedBuilds}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="help">
            合计：产物 {bytes(data.usage.artifacts)} · 日志{" "}
            {bytes(data.usage.logs)} · 临时构建 {bytes(data.usage.work)} · 图标{" "}
            {bytes(data.usage.icons)} · 其他 {bytes(data.usage.other)}
          </p>
          <div className="storage-actions">
            <div>
              <strong>
                {ready.length} 个历史版本、{logs.length} 份日志可清理
              </strong>
              <p>{grace.length} 个版本仍在宽限期内，本次不会删除。</p>
            </div>
            <button
              className="danger-text"
              disabled={loading || cleaning || data.running || !count}
              onClick={() => setConfirming(true)}
            >
              {cleaning ? (
                <Loader2 className="spin" size={15} />
              ) : (
                <Trash2 size={15} />
              )}{" "}
              {cleaning ? "正在清理…" : "手动清理"}
            </button>
          </div>
          {confirming && (
            <div className="cleanup-confirm" role="group" aria-label="确认清理">
              <h3>确认清理约 {bytes(data.cleanup.reclaimableBytes)}？</h3>
              <p>
                保留构建记录。清理后，对应历史产物无法下载或直接发布，过期日志无法查看；需要时可重新构建。执行时会重新检查线上、回滚和保留规则。
              </p>
              <ul>
                {[
                  ...ready.map((b) => ({ ...b, type: "产物" })),
                  ...logs.map((b) => ({ ...b, type: "日志" })),
                ]
                  .slice(0, 50)
                  .map((b) => (
                    <li key={b.type + b.id}>
                      {data.projects.find((p) => p.id === b.projectId)?.name ||
                        b.projectId}{" "}
                      · {b.id.slice(0, 8)} · {b.type} · {bytes(b.bytes)}
                    </li>
                  ))}
              </ul>
              {count > 50 && (
                <p>仅列出前 50 项，本次将按规则清理全部 {count} 项。</p>
              )}
              <div className="storage-buttons">
                <button
                  disabled={cleaning}
                  onClick={() => setConfirming(false)}
                >
                  取消
                </button>
                <button className="primary" disabled={cleaning} onClick={clean}>
                  {cleaning ? "正在清理…" : "确认按规则清理"}
                </button>
              </div>
            </div>
          )}
          {!!grace.length && (
            <details>
              <summary>查看宽限期中的 {grace.length} 个版本</summary>
              <ul>
                {grace.slice(0, 50).map((b) => (
                  <li key={b.id}>
                    {data.projects.find((p) => p.id === b.projectId)?.name} ·{" "}
                    {b.id.slice(0, 8)} · 最早清理时间 {stamp(b.deleteAfter)}
                  </li>
                ))}
              </ul>
              {grace.length > 50 && <p>仅列出前 50 个版本。</p>}
            </details>
          )}
          {data.lastRun && (
            <div className="storage-last-run" role="status">
              <p>
                上次{data.lastRun.source === "manual" ? "手动" : "自动"}清理：
                {stamp(data.lastRun.finishedAt)}，清理 {data.lastRun.artifacts}{" "}
                个版本、{data.lastRun.logs} 份日志，释放{" "}
                {bytes(data.lastRun.freedBytes)}。
              </p>
              {data.lastRun.errors.length > 0 && (
                <p className="error-text">
                  {data.lastRun.errors.length} 项清理失败，下次检查重试：
                  {data.lastRun.errors
                    .slice(0, 3)
                    .map((e) => e.message)
                    .join("；")}
                </p>
              )}
            </div>
          )}
          <small className="muted">统计时间：{stamp(data.checkedAt)}</small>
        </>
      )}
    </section>
  );
}
