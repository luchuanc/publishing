import { access, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
try {
  await access(".env");
  console.log(".env 已存在，保留现有配置。");
} catch {
  const password = randomBytes(24).toString("base64url");
  await writeFile(
    ".env",
    `HOST=127.0.0.1\nPORT=8080\nPUBLIC_URL=http://127.0.0.1:8080\nGAME_PUBLIC_HOST=127.0.0.1\nPUBLIC_PORT=8200\nDATA_DIR=.data\nADMIN_PASSWORD=${password}\n`,
    { flag: "wx", mode: 0o600 },
  );
  console.log(
    "已创建 .env，随机管理密码保存在 ADMIN_PASSWORD 字段。请在编辑器中查看，勿提交 Git。",
  );
}
