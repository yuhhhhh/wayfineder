# Wayfinder

Wayfinder 是运行在 NAS 本地的只读对话式运维助手。它通过飞书/Lark 出站长连接接收消息，使用 Pi Agent Core 选择严格注册的工具，并将会话、审计和事件去重信息存入 SQLite。

当前版本是 Phase 0 + Phase 1 的可运行代码基线，尚未完成 Debian/FNOS NAS 实机验收。它只注册以下五个只读工具：

- `get_nas_overview`
- `get_wifi_status`
- `get_disk_status`
- `get_docker_status`
- `get_recent_alerts`

项目没有通用 Shell、文件读写或任意网络请求工具，也没有实现容器重启、备份或 Wi-Fi 重连。生产部署首选 systemd；原因见 [部署决策](docs/decisions/0001-systemd-primary.md)。

当前诊断覆盖有意保持保守：磁盘 SMART/内核 I/O 与 Wi-Fi 网关探测尚未采集；Docker 在安全只读代理完成前通常返回 `unavailable`。因此本版本适合代码审查和安全的实机只读验收，不应视为完整生产监控替代品。

## 本地启动

需要 Node.js 22.19 或更高的 22.x 版本，以及 npm 10。

```bash
npm ci
cp .env.example .env
npm run config:check
npm run dev
```

默认配置关闭模型和飞书，仅启动本机健康检查并初始化业务 SQLite；Pi 会话库会在首个模型请求时惰性初始化。启用前，在 `.env` 中同时配置模型、飞书凭证和用户角色白名单：

```dotenv
WAYFINDER_LARK_ENABLED=true
WAYFINDER_LARK_APP_ID=cli_xxx
WAYFINDER_LARK_APP_SECRET=replace_me
WAYFINDER_USER_ROLES=ou_xxx:admin

WAYFINDER_MODEL_ENABLED=true
WAYFINDER_MODEL_PROVIDER=openai
WAYFINDER_MODEL_ID=replace_me
WAYFINDER_MODEL_API_KEY=replace_me
```

群聊还需加入 `WAYFINDER_ALLOWED_CHAT_IDS`；群里只有明确 @ 机器人时才处理。不要提交 `.env`、数据库或密钥文件。

## 验证

```bash
npm run check
```

`check` 会依次检查格式、静态规则、TypeScript、单元/集成测试和生产构建。健康端点仅绑定回环地址：

- `GET /health/live`：进程存活。
- `GET /health/ready`：SQLite 必须可写；关闭或未连接的可选下游会显示为降级原因。

## 生产部署

按 [systemd 部署手册](docs/deployment.md)操作。`compose.dev.yaml` 只用于隔离的开发验证：容器看到的是自己的磁盘和网络命名空间，因此不能代表 NAS 主机状态，也不会挂载 `/var/run/docker.sock`。

更多内容：

- [架构与信任边界](docs/architecture.md)
- [安全模型](docs/security.md)
- [实施状态](docs/implementation-status.md)

## 常见故障

- 配置检查失败：运行 `npm run config:check`，按稳定错误码补齐凭证、模型 ID 和白名单；不要把真实值贴入日志或 issue。
- `/health/ready` 为 `not_ready`：先检查数据目录是否可写以及 SQLite 迁移错误；生产目录必须是 `/var/lib/wayfinder`。
- ready 为 `degraded`：响应中的 `reasonCodes` 会区分飞书/模型未启用或长连接断开；用 `journalctl -u wayfinder` 查看不含敏感值的结构化事件。
- Wi-Fi、磁盘或 Docker 显示 `unavailable`：核对 NAS 上固定命令的绝对路径和低权限账户读取权限。不要通过授予 root、docker 组或挂载 Docker socket 来绕过。
- 飞书没有回复：检查用户/群 allowlist、群内是否明确 @ 机器人，以及长连接状态；无需开放 NAS 公网端口。
