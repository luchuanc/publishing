import React, { useEffect, useState } from "react";
import { Box, Loader2, Plus, RotateCcw } from "lucide-react";

const empty = {
  id: "",
  name: "",
  url: "",
  version: "",
  icon: "",
  enabled: true,
  orientation: "portrait",
};
const orientationLabels = {
  portrait: "竖屏",
  landscape: "横屏",
  auto: "跟随系统",
};

export default function CatalogSettings({
  api,
  system,
  IconField,
  Modal,
  onChanged,
}) {
  const [entries, setEntries] = useState([]),
    [loading, setLoading] = useState(true);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [form, setForm] = useState(null),
    [saving, setSaving] = useState(false),
    [uploading, setUploading] = useState(false);
  const [formError, setFormError] = useState("");
  async function load() {
    setLoading(true);
    setError("");
    try {
      setEntries((await api("/catalog/entries")).entries);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, [system.publicOrigin]);
  const update = (key, value) => setForm((old) => ({ ...old, [key]: value }));
  function edit(entry) {
    setForm(entry ? { ...entry, isNew: false } : { ...empty, isNew: true });
    setFormError("");
    setNotice("");
  }
  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setFormError("");
    try {
      const payload = Object.fromEntries(
        [
          "id",
          "name",
          "url",
          "version",
          "icon",
          "enabled",
          "revision",
          "orientation",
        ].map((k) => [k, form[k]]),
      );
      await api(
        form.isNew ? "/catalog/entries" : `/catalog/entries/${form.id}`,
        {
          method: form.isNew ? "POST" : "PUT",
          body: JSON.stringify(payload),
        },
      );
      setForm(null);
      setNotice("已保存到公开应用列表，App 下次启动或刷新列表时读取生效。");
      await load();
      await onChanged();
    } catch (e) {
      setFormError(e.message);
    } finally {
      setSaving(false);
    }
  }
  const busy = saving || uploading;
  return (
    <section className="catalog-settings" aria-label="公开应用列表配置">
      <div className="catalog-heading">
        <div>
          <h2>公开应用列表</h2>
          <p>管理 App 可读取的名称、地址、图标、版本和屏幕方向。</p>
        </div>
        <div className="catalog-buttons">
          <button disabled={loading || busy} onClick={load}>
            <RotateCcw size={15} /> 刷新列表
          </button>
          <button
            className="primary"
            disabled={loading || busy || !!error}
            onClick={() => edit()}
          >
            <Plus size={16} /> 新增应用
          </button>
        </div>
      </div>
      <p>
        已发布的网页项目自动加入列表，也可新增外部 H5
        应用。保存后立即更新公开接口，无需重新构建网页。
      </p>
      <a href={system.catalogUrl} target="_blank" rel="noreferrer">
        查看公开列表
      </a>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="catalog-notice" role="status">
          {notice}
        </p>
      )}
      {loading && !entries.length ? (
        <p role="status">正在读取应用列表…</p>
      ) : (
        <div className="table-scroll">
          <table className="catalog-table">
            <thead>
              <tr>
                <th>应用 / 来源</th>
                <th>访问地址 / 版本</th>
                <th>公开状态</th>
                <th>屏幕方向</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td>
                    <div className="catalog-game">
                      {entry.iconFile ? (
                        <img
                          src={`/api/icons/${entry.iconFile}`}
                          width="44"
                          height="44"
                          alt=""
                        />
                      ) : (
                        <span className="catalog-placeholder">
                          <Box size={22} />
                        </span>
                      )}
                      <div>
                        <strong>{entry.game.name}</strong>
                        <small>
                          {entry.id} ·{" "}
                          {entry.projectId
                            ? `项目：${entry.projectName}`
                            : "外部 H5"}
                        </small>
                      </div>
                    </div>
                  </td>
                  <td>
                    <a href={entry.game.url} target="_blank" rel="noreferrer">
                      {entry.game.url}
                    </a>
                    <small>版本：{entry.game.version}</small>
                  </td>
                  <td>
                    {!entry.enabled
                      ? "已隐藏"
                      : !entry.available
                        ? entry.unavailableReason
                        : "已公开"}
                  </td>
                  <td>{orientationLabels[entry.orientation]}</td>
                  <td>
                    <button
                      aria-label={`编辑 ${entry.game.name}`}
                      onClick={() => edit(entry)}
                    >
                      编辑
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!entries.length && (
            <p>暂无应用。新增外部 H5，或发布一个网页项目后开始配置。</p>
          )}
        </div>
      )}
      <p>
        App 保持原有的一次选择规则：已选应用按 ID
        更新地址，切换到其他应用仍需重置
        App。隐藏只影响公开列表，不会清除用户已有的选择和缓存。
      </p>
      <p>
        Android 桌面图标和桌面名称随 APK
        打包。修改图标、或为新增应用配置专属桌面入口后，需要重新构建并安装
        APK；仅刷新列表不会更新桌面图标。
      </p>
      {form && (
        <Modal
          title={form.isNew ? "新增公开应用" : "编辑公开应用"}
          subtitle={
            form.projectId
              ? "关联项目的字段留空时自动跟随项目配置；不会修改项目构建参数。"
              : "将可访问的 H5 地址加入 App 的远端应用列表。"
          }
          onClose={() => {
            if (!busy) setForm(null);
          }}
        >
          <form className="catalog-form" onSubmit={save}>
            <fieldset disabled={busy}>
              <label>
                应用标识
                <input
                  value={form.id}
                  onChange={(e) => update("id", e.target.value)}
                  disabled={!form.isNew}
                  required
                  maxLength={40}
                  pattern={"[a-zA-Z][a-zA-Z0-9\\-]{1,39}"}
                  placeholder="例如 my-game"
                />
              </label>
              <p className="help">保存后标识固定，App 用它记住所选应用。</p>
              <label>
                显示名称
                <input
                  value={form.name}
                  onChange={(e) => update("name", e.target.value)}
                  required={!form.projectId}
                  maxLength={80}
                  placeholder={form.defaults?.name || "应用名称"}
                />
              </label>
              <label>
                应用链接
                <input
                  value={form.url}
                  onChange={(e) => update("url", e.target.value)}
                  required={!form.projectId}
                  maxLength={2048}
                  placeholder={
                    form.defaults?.url ||
                    "https://example.com/game/ 或 /my-game/"
                  }
                />
              </label>
              <p className="help">
                站内路径随生产域名切换；外部网址保持原地址。链接中需要的空格请写为
                %20。
              </p>
              <label>
                版本标识
                <input
                  value={form.version}
                  onChange={(e) => update("version", e.target.value)}
                  maxLength={80}
                  placeholder={
                    form.defaults?.version || "留空使用 latest，例如 1.0.0"
                  }
                />
              </label>
              <label>
                屏幕方向
                <select
                  value={form.orientation}
                  onChange={(e) => update("orientation", e.target.value)}
                >
                  <option value="portrait">竖屏</option>
                  <option value="landscape">横屏</option>
                  <option value="auto">跟随系统</option>
                </select>
              </label>
              <p className="help">
                需安装支持方向配置的新版
                App。保存后下次启动或刷新列表生效，无需再次打包。
              </p>
              <IconField
                value={form.icon}
                onChange={(icon) => update("icon", icon)}
                onUploading={setUploading}
                label="应用图标"
              />
              {form.projectId && (
                <p className="help">
                  未单独上传时使用项目图标，名称、链接和版本留空时自动跟随项目。
                </p>
              )}
              <label className="catalog-toggle">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(e) => update("enabled", e.target.checked)}
                />{" "}
                在公开列表中显示
              </label>
            </fieldset>
            {formError && (
              <p role="alert" className="error-text">
                {formError}
              </p>
            )}
            <div className="modal-actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => setForm(null)}
              >
                取消
              </button>
              <button className="primary" disabled={busy}>
                {busy && <Loader2 size={16} className="spin" />}{" "}
                {saving
                  ? "正在保存…"
                  : uploading
                    ? "正在上传…"
                    : "保存应用配置"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
