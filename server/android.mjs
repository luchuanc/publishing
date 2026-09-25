import { createHash } from "node:crypto";
import {
  mkdir,
  writeFile,
  readFile,
  cp,
  readdir,
  lstat,
} from "node:fs/promises";
import path from "node:path";

const invalid = (message) => {
  throw Object.assign(new Error(message), { status: 400 });
};
export function httpUrl(value) {
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      !url.hostname
    )
      throw new Error();
    return url.href;
  } catch {
    invalid("链接必须是完整 HTTP 或 HTTPS 地址，不含用户名和密码");
  }
}
export function androidConfig(value = {}) {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      invalid("App 配置无效");
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    invalid("App 配置无效");
  const config = {
    appName: String(value.appName || "游戏中心").trim(),
    versionName: String(value.versionName || "1.0.0").trim(),
    versionCode: Number(value.versionCode ?? 1),
    defaultGameId: String(value.defaultGameId || ""),
    gameUrl: value.gameUrl ? httpUrl(String(value.gameUrl).trim()) : "",
    icon: String(value.icon || ""),
  };
  if (
    !config.appName ||
    config.appName.length > 40 ||
    /[\x00-\x1f]/.test(config.appName)
  )
    invalid("App 名称应为 1–40 字符");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.+_-]{0,49}$/.test(config.versionName))
    invalid("版本号无效，例如 1.0.0");
  if (
    !Number.isInteger(config.versionCode) ||
    config.versionCode < 1 ||
    config.versionCode > 2100000000
  )
    invalid("版本代码应为 1–2100000000 的整数");
  if (
    config.defaultGameId &&
    !/^[a-zA-Z][a-zA-Z0-9-]{1,39}$/.test(config.defaultGameId)
  )
    invalid("默认游戏无效");
  if (config.icon && !/^[0-9a-f]{64}\.png$/.test(config.icon))
    invalid("请重新上传 App 图标");
  return config;
}
export async function saveIcon(dataDir, input) {
  if (
    typeof input !== "string" ||
    !/^data:image\/png;base64,[a-zA-Z0-9+/=]+$/.test(input)
  )
    invalid("图标请使用 PNG 图片");
  const bytes = Buffer.from(input.split(",")[1], "base64");
  if (bytes.length > 2 * 1024 * 1024) invalid("图标不能超过 2 MB");
  if (
    bytes.length < 33 ||
    bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
    bytes.toString("ascii", 12, 16) !== "IHDR"
  )
    invalid("PNG 图片无效");
  const width = bytes.readUInt32BE(16),
    height = bytes.readUInt32BE(20);
  if (width < 48 || width > 2048 || width !== height)
    invalid("图标应为 48–2048 像素的正方形 PNG");
  const filename = createHash("sha256").update(bytes).digest("hex") + ".png";
  await mkdir(path.join(dataDir, "icons"), { recursive: true });
  await writeFile(path.join(dataDir, "icons", filename), bytes, {
    mode: 0o600,
  });
  return { icon: filename, width, height };
}
export async function prepareAndroid(checkout, dataDir, config) {
  // h5-app consumes this untracked file at build time; every attempt stores a snapshot.
  await writeFile(
    path.join(checkout, "publishing.json"),
    JSON.stringify(config, null, 2),
  );
  if (config.icon)
    await cp(
      path.join(dataDir, "icons", config.icon),
      path.join(checkout, "publishing-icon.png"),
    );
}
export async function collectApk(output, destination) {
  const apks = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name),
        info = await lstat(file);
      if (info.isSymbolicLink()) throw new Error("APK 产物不能包含符号链接");
      if (info.isDirectory()) await walk(file);
      else if (info.isFile() && entry.name.endsWith(".apk")) apks.push(file);
    }
  }
  await walk(output);
  if (apks.length !== 1)
    throw new Error("产物目录应包含一个可安装 APK，请检查构建命令与产物目录");
  const bytes = await readFile(apks[0]);
  if (bytes.subarray(0, 4).toString("hex") !== "504b0304")
    throw new Error("APK 文件格式无效");
  await mkdir(destination, { recursive: true });
  await cp(apks[0], path.join(destination, "app.apk"));
  return {
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
