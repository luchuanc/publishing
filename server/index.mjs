import { mkdir } from "node:fs/promises";
import { configuration } from "./config.mjs";
import { openStore, acquireInstanceLock } from "./store.mjs";
import { PublishingService } from "./service.mjs";
import { createApp } from "./app.mjs";
import { closeHttpServer } from "./http-lifecycle.mjs";

const config = configuration();
await mkdir(config.dataDir, { recursive: true, mode: 0o700 });
const lock = acquireInstanceLock(config.dataDir);
const db = openStore(config.dataDir);
const service = new PublishingService(db, config);
const app = createApp(service, config);
let closing = false;
async function close(code = 0) {
  if (closing) return;
  closing = true;
  await closeHttpServer(app);
  await service.close();
  db.close();
  lock.close();
  process.exitCode = code;
}
try {
  await service.start();
  await new Promise((resolve, reject) => {
    app.once("error", reject);
    app.listen(config.port, config.host, resolve);
  });
  console.log(`Launchpad 已启动：${config.publicUrl}`);
  console.log(`公开资源：${service.publicOrigin()}，数据：${config.dataDir}`);
} catch (error) {
  console.error(error.message);
  await close(1);
}
process.on("SIGTERM", () => void close());
process.on("SIGINT", () => void close());
