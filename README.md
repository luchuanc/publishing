# Launchpad · 单机游戏打包发布平台

从远端 Git 仓库拉取代码，构建静态游戏和 Android 调试 APK，生成固定访问/下载地址，并管理发布和回滚。游戏本身不需要服务端；平台使用 Node.js 管理构建、登录和静态文件托管。

![游戏发布工作台](docs/dashboard.png)

## 功能

- 默认接入 Android `h5-app` 及 `zizou`（山海弈）、`xiangsu`（像素远征）、`backHome`（最后一家回收站）。
- 项目管理与发布单分离：项目维护仓库、默认分支、命令、产物目录和访问地址，支持归档与恢复。
- 发布单支持新增、编辑、删除；新建时选择项目，从远端 Git 读取并选择分支。支持按项目、最近构建状态筛选和搜索。
- 同一发布单可反复构建发布，每次构建记录独立的分支、提交、产物和日志；进入发布单直接查看实时日志、切换历史构建、下载日志。
- 顺序构建队列，独立 Git 克隆目录、确切提交 SHA、实时轮询日志、日志下载、超时、取消、失败重试。
- 构建后自动发布，或仅保存产物后手动发布。
- 按保留规则保存历史成功产物，保留版本可直接发布、一键回滚上一版。访问地址固定；发布与回滚记录在 SQLite 事务中一起更新。
- 构建日志保留 30 天，每项目保留最近 10 个成功版本，额外保护线上版和上一版；旧资源享有 7 天清理宽限期，提供磁盘占用与手动清理入口。
- 失败或取消的构建不影响线上版本；重启后运行中的构建标为失败，排队任务恢复执行。
- 管理密码、HttpOnly 会话、来源校验、登录失败限流。游戏在与后台分离的统一端口/域名托管，不能访问管理 API。

## 发布单使用方式

1. 在「项目管理」新增项目或修改仓库、构建命令、产物目录。项目的分支仅作为新发布单的默认值。
2. 在「发布单」选择项目，等待远端分支列表加载，选择分支、填写名称与说明，创建发布单。
3. 进入发布单点击「构建并发布」。关闭自动发布时按钮为「开始构建」，成功后可在构建记录中手动发布。
4. 再次点击构建会创建新的构建记录；通过「选择构建记录」查看任意一次的独立日志。编辑分支或发布方式仅影响后续构建。
5. 构建运行中先取消或等待结束，再编辑/删除。产生构建后不能更换所属项目；可以继续修改分支、名称、说明和发布方式。
6. 含当前线上版本或上一版的发布单不能删除，确保访问与回滚可用。其他发布单删除后从管理界面移除；底层产物与日志仍按统一保留规则清理，删除发布单不会立即释放磁盘。

已有数据库会在启动时自动迁移，每条历史构建生成一个发布单，原构建编号、日志和当前/上一版引用保留；游戏地址迁移为统一端口下的项目子目录。升级前备份 `.data` 和 `.env`，不要在新旧代码之间同时运行同一个数据目录。

## 本机运行

要求 Node.js **24.11+（24 LTS）**、npm、Git、SSH；Linux 和 macOS 均可。使用 `nvm use` 切换版本。

```sh
npm ci
npm run setup
npm run build
npm start
```

`setup` 只在不存在 `.env` 时生成配置，创建随机密码并以权限 0600 保存，不打印密码。用编辑器打开 `.env` 查看 `ADMIN_PASSWORD`，打开 <http://127.0.0.1:8080> 登录。后台默认接入三个游戏和 Android App，进入“发布单 → 新建发布单”选择项目与分支，创建后点击“构建并发布”。未发布时游戏地址返回 503，首次成功发布后页面显示可用地址。

本机默认地址：

| 应用 | 地址 |
| --- | --- |
| 发布后台 | `http://127.0.0.1:8080` |
| 山海弈 | `http://127.0.0.1:8200/zizou/` |
| 像素远征 | `http://127.0.0.1:8200/xiangsu/` |
| 最后一家回收站 | `http://127.0.0.1:8200/backHome/` |

所有游戏、APK 下载与公开列表共用 `PUBLIC_PORT=8200`。项目标识即子目录，不再为每个游戏分配监听端口。UI 自动轮询，每 2.5 秒更新状态，日志每 1.8 秒更新。

## Linux：Docker Compose 部署

```sh
git clone git@github.com:luchuanc/publishing.git
cd publishing
cp .env.example .env
mkdir -p deploy/ssh
```

编辑 `.env`，至少设置：

```dotenv
PUBLIC_URL=http://你的服务器IP:8080
GAME_PUBLIC_HOST=你的服务器IP
ADMIN_PASSWORD=替换成至少12位的唯一管理密码
PUBLIC_PORT=8200
```

GitHub 的 SSH 仓库需要服务器自己的读取权限。将专用 SSH 私钥、配置及**已验证**的 `known_hosts` 放入 `deploy/ssh/`。不需要给服务器推送权限。使用 SSH agent 的本机直接运行方式可沿用现有 SSH 配置；容器不会自动继承宿主机 agent。

```sh
# 容器使用 node 用户 UID 1000。不要对其他 SSH 目录执行此命令。
sudo chown -R 1000:1000 deploy/ssh
sudo chmod 700 deploy/ssh
sudo chmod 600 deploy/ssh/id_ed25519
# known_hosts 至少需要 GitHub 主机公钥。先与 GitHub 官方指纹比对，勿禁用主机校验。
docker compose up -d --build
docker compose logs -f publishing
```

每个 SSH deploy key 通常对应一个仓库。多个仓库可使用具有这些仓库读取权限的专用 GitHub 机器账号，或在 SSH config 中为各仓库配置不同 Host 别名和 IdentityFile，并在平台仓库地址使用对应别名。公有仓库也可改用 `https://github.com/luchuanc/项目名.git`，免 SSH。

容器内构建会执行 `npm ci` 等命令，需要访问 npm 和 GitHub。数据在 `publishing-data` 命名卷，重新构建容器不会删除版本和记录。**不要使用 `docker compose down -v`，它会删除发布数据。** 防火墙放行管理端口 8080 和统一资源端口 8200；同一数据卷只运行一个实例。

### 统一域名与 HTTPS

提供 `deploy/nginx.conf.example`。所有公开资源只需一个反向代理上游 `http://127.0.0.1:8200`，保留请求完整路径。例如：

- 游戏：`https://games.xxx.site:8888/xiangsu/`
- APK：`https://games.xxx.site:8888/downloads/h5-app/<构建ID>/app.apk`
- 当前发布的 APK：`https://games.xxx.site:8888/downloads/h5-app/latest/app.apk`
- 公开游戏列表：`https://games.xxx.site:8888/api/catalog`

在「平台设置 → 生产域名」保存 `https://games.xxx.site:8888`，所有游戏地址、历史 APK 下载链接和列表内链接立即更新，无需重建。清空则恢复服务器地址。域名、端口和 HTTPS 证书由反向代理配置，平台不会自动创建 DNS 或证书。管理后台保持不同 origin（例如 `https://publish.xxx.site`），`.env` 的 `PUBLIC_URL` 必须等于浏览器管理地址；HTTPS 后台设置 `COOKIE_SECURE=true`。

升级前备份数据。旧三款游戏的成功产物自动生成子目录兼容副本，原产物保留，因此旧版本也能回滚。浏览器存档属于原 origin；从原游戏端口迁移到新 origin 前，使用游戏自身的导出功能备份玩家存档，平台不会迁移浏览器数据。山海弈离线缓存按游戏路径隔离；PWA 需要 HTTPS 或 localhost。

### 按应用切换桌面图标

在「项目管理 → 对应网页游戏 → 配置 → 应用图标」上传该游戏的正方形 PNG（48–2048 像素，最大 2 MB）。Android 项目的图标是未选择应用时的默认图标。App 完成首次选择后，桌面入口使用所选应用的图标；未配置专属图标的游戏回退到默认图标。内置账本、积分等内容保留各自图标。

`/api/catalog` 的游戏项增加 `icon` 字段，返回当前生产域名下的公开图片地址，未配置时为空字符串。修改图标会立即反映在目录中，但 Android 桌面图标必须随 APK 预先打包：保存图标后重新构建、安装 APK，才会更新手机桌面图标。仅刷新远端列表不能替换已安装 APK 的图标资源。

每次 Android 构建固定游戏列表及图标文件哈希；`publishing.json` 的 `games[].iconFile` 对应 `publishing-icons/<hash>.png`。排队后修改图标不会改变该次构建，历史版本和回滚产物也保留原图标。h5-app 根据稳定游戏 ID 生成 launcher aliases，在同一个 App 内切换桌面入口。

### Android 调试 APK

已有安装在项目管理中新建 `Android APK`，仓库 `git@github.com:luchuanc/h5-app.git`，构建命令 `sh ./gradlew --no-daemon --console=plain :app:assembleDebug`，产物目录 `app/build/outputs/apk/debug`，安装命令留空。新安装默认包含该项目。

配置 App 名称、PNG 图标、版本号、递增的整数版本代码和默认游戏。游戏链接留空会自动使用所选项目地址，也可覆盖为自定义 HTTP/HTTPS 链接。每次构建固化这些配置与当时游戏列表，日志和产物属于该次构建；成功后在构建历史「下载 APK」。同一发布单可多次构建，发布/回滚会切换 `latest` 下载地址，历史 APK 链接保持对应版本。

App 调试包右上角「游戏」打开 Bundle 选择器，自动读取平台最新已发布游戏；支持手动刷新和修改列表地址。选中后保存游戏 ID 与地址，下次启动自动打开。刷新失败使用缓存列表，游戏本身仍需网络或各自的离线缓存。更新域名时让旧列表入口继续可访问/重定向，新域名会随列表同步；如果旧域名完全停止解析，已安装 App 需手动修改列表地址或安装新 APK。自定义外部地址保持不变。

构建环境需要 [JDK 17、Gradle 8.13](https://developer.android.com/build/releases/agp-8-11-0-release-notes)、Android SDK platform 36 和 build-tools 35.0.0。仓库带 Gradle Wrapper，首次构建下载依赖。Docker 镜像已包含 JDK/SDK；普通用户执行 `sh deploy/install-android-tools.sh`（需要 Node 24、curl、unzip、tar，支持 Linux x64/macOS Intel），将脚本输出的 `JAVA_HOME`、`ANDROID_HOME` 写入 `.env` 后重启。首次构建建议 `BUILD_TIMEOUT_MINUTES=40`。

调试 APK 自动使用运行用户 `~/.android/debug.keystore` 签名。备份此文件以保持覆盖安装兼容；Docker 用独立持久卷保存签名与 Gradle 缓存。图标和版本写在 APK 内，修改后需要重新构建安装；回滚下载链接不会自动降级手机已安装的 App。当前是供直接安装测试的调试包。

### 不使用 Docker

在 Linux 安装 Node 24、Git、OpenSSH，使用专用普通用户运行，执行与本机相同的安装命令。可用 `deploy/publishing.service` 启动 systemd 服务，按实际安装目录与 Node 路径调整。`.env` 的 `HOST=0.0.0.0` 允许外部访问；管理密码与 Git SSH 权限分别配置。

### 只有普通用户权限

如果无法访问 Docker，也没有 systemd 用户服务，服务器已有的 cron 可以托管本应用。先完成 `npm ci`、构建与 `.env` 配置，然后运行：

```sh
sh deploy/install-user-service.sh /完整路径/node
```

Node 必须为 24 版本，例如 `/home/your-user/.nvm/versions/node/v24.21.0/bin/node`。安装脚本保留原有用户任务，添加本应用的开机启动和每分钟恢复检查，使用 `flock` 保证只启动一个实例；它不会修改系统用户权限。服务由 cron 启动，因此临时部署终端断开后仍继续运行。

- 日志：`.data/service.log`；进程号：`.data/service.pid`。
- 停止：删除 `.data/service.enabled`，核对进程号对应本应用后终止该进程。
- 恢复：创建 `.data/service.enabled`，等待最多一分钟。
- 更新：拉取代码并重新构建，终止当前服务进程，cron 会在下一次每分钟检查时恢复。关闭时先等待正在处理的请求，管理后台和游戏连接各最多等待 5 秒，避免浏览器预连接阻止重启。检查 `/healthz` 与游戏访问地址。
- 完全卸载自启动：在 `crontab -e` 中仅删除 `BEGIN publishing-user-service` 与 `END publishing-user-service` 之间的块，保留其他任务。

## 游戏接入约定

| 仓库 | 安装 | 构建 | 产物 |
| --- | --- | --- | --- |
| `git@github.com:luchuanc/zizou.git` | `npm ci` | `npm run build` | `dist/` |
| `git@github.com:luchuanc/xiangsu.git` | `npm ci` | `npm run build` | `dist/` |
| `git@github.com:luchuanc/backHome.git` | 无依赖，留空 | `npm run build` | `dist/` |

新增项目默认构建 `main` 分支，每次克隆这个分支当时的最新提交。分支可以修改，暂不提供 tag/任意 SHA 选择。命令在仓库根目录执行。输出必须在仓库内的独立目录，包含 `index.html`，不能含符号链接、隐藏文件或 `node_modules`。Web 构建子进程收到 `PUBLISHING_BASE_PATH=/<项目标识>/`；Vite 配置需读取它作为 `base`，动态资源 URL 同样应使用 `import.meta.env.BASE_URL`。Android 产物目录应包含一个 APK。Git 子模块与 LFS 暂未自动安装。

`backHome` 构建同时保留原来的“最后一家回收站.html”离线文件，以及平台需要的 `dist/index.html`。构建产物不提交到游戏仓库，源码及必要资源提交。

## 数据、更新与备份

- `.data/publishing.sqlite`：项目配置、构建状态、发布事件；启用 WAL。
- `.data/releases/<构建ID>/`：成功构建产物，每个版本独立目录，不覆盖。
- `.data/subpath-releases/`：旧三款游戏的子目录兼容副本；原版本文件保留。
- `.data/icons/`：按内容哈希保存上传图标。
- `.data/logs/<构建ID>.log`：每份最多 4 MB，构建结束后保留 30 天。
- `.data/work/`：临时克隆目录，任务结束后清理。
- 成功产物与日志自动清理，规则见下文；没有磁盘配额，仍需监控可用空间。不要直接删除线上产物目录。
- 备份时先停止服务，完整备份 `.data`（包括 SQLite WAL 文件）或 Docker 数据卷，再启动。恢复时保持项目端口与域名，避免影响玩家原 origin 下的存档。
- 平台更新：拉取新代码，`npm ci && npm run build` 后重启；Docker 使用 `docker compose up -d --build`。重启会使已有管理会话失效，需要重新登录。
- 游戏回滚不回滚玩家本地存档。游戏代码应保持存档兼容，否则先在游戏中导出备份。

### 存储与清理

入口为「平台设置 → 存储与清理」，显示磁盘可用/总容量、平台数据总量、各项目产物/日志/临时构建占用，以及可清理空间。统计按需刷新，不随工作台状态轮询反复扫描磁盘。

- **日志 30 天**：从构建结束时间起算；没有结束时间则使用创建时间。运行中、排队中的构建不清理日志。线上版本的产物受保护，但它的日志同样只保留 30 天。
- **每项目最近 10 个成功版本**：按构建完成时间排序，跨发布单计算。当前线上版本与上一版始终额外保护，因此实际保留数量可能超过 10。归档项目及已删除发布单的构建仍参与同样的规则。
- **旧资源宽限期 7 天**：成功版本离开上述保留范围时开始计时，宽限期内仍可加载旧哈希资源；重新成为线上/上一版后取消清理资格，再次退出保护时重新计时。兼容副本与原始产物一起清理。首次升级会从升级时开始计时，不会因构建日期久远而立即删除产物。
- **自动检查**：服务启动时及运行期间每小时执行。删除中断或失败会记录错误并重试；与发布/回滚串行检查，避免删除正被切换上线的版本。
- **手动清理**：先预览符合规则的版本、日志和估计释放空间，再确认执行；不会跳过宽限期或强制删除受保护版本。执行时重新检查保护状态，完成后显示实际清理数量、释放空间和失败项。

清理后保留构建记录，界面标注「产物已清理」或日志过期；产物不能直接发布或下载，可重新构建。历史 APK 地址返回 410，`latest` 和线上游戏保持可用。数据库、图标、服务运行日志仅统计不自动删除，平台外的备份、npm/Gradle 缓存不在本规则内。克隆代码与依赖仍在每次构建结束时清理，启动时清除遗留临时目录。

管理接口 `GET /api/storage` 返回统计与清理预览，`POST /api/storage/cleanup` 执行同一规则；均要求登录，写操作沿用来源校验。保留规则集中在 `server/storage.mjs` 的 `retentionPolicy`。

## 安全边界

平台面向单个可信管理员，不是运行陌生代码的公共 CI。Git 依赖安装与自定义构建命令是任意代码执行，会以平台用户身份运行，**不是沙箱**。只接入可信仓库，不以 root 运行，不挂载 Docker socket 或无关凭据。传入构建子进程的环境使用白名单，不包含管理密码；但可信构建仍能访问平台用户可读的本机文件。私钥、密码、`.env`、SQLite 与版本目录均不提交 Git。公网使用 HTTPS。

## 开发与验证

```sh
npm run check
npm test
npm run build
```

测试使用真实临时 Git 仓库与构建命令，覆盖发布/回滚、并发状态保护、旧资源访问、仅构建、失败保留版本、取消、重启恢复、归档恢复、登录与 CSRF、路径隔离、构建超时、多项目保留规则、清理与发布并发、宽限期、过期日志/APK 和清理失败重试。`npm run dev` 仅供前端热更新；使用时将服务的 `PUBLIC_URL` 设置为 Vite 地址 `http://localhost:5173`，启动后台后从该地址访问。

前端：React + Vite；后端：Node 内置 HTTP、SQLite、child_process；无外部数据库。需要 Node 24，Node 20 不支持这里使用的 `node:sqlite` API。
