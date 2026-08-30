# systemd 部署手册

以下命令是部署说明，不会由项目自动执行。先确认 NAS 已安装 Node.js 22.19+、npm 10、`iw`、`iproute2` 和 `coreutils`。

1. 创建低权限系统用户和目录，将仓库部署到 `/opt/wayfinder`。
2. 在构建机或 NAS 上运行 `npm ci && npm run check`，再运行 `npm prune --omit=dev`。
3. 将 `deploy/systemd/wayfinder.env.example` 复制为 `/etc/wayfinder/wayfinder.env`，填入真实值，设置 `root:wayfinder` 和 `0640`。不要用根目录的开发模板替代它；生产模板固定使用 `/var/lib/wayfinder`。
4. 将 `deploy/systemd/wayfinder.service` 安装到 `/etc/systemd/system/`，将 tmpfiles 配置安装到 `/usr/lib/tmpfiles.d/`。
5. 执行 `systemd-tmpfiles --create wayfinder.conf`，再由管理员执行 daemon-reload、enable 和 start。

服务数据位于 `/var/lib/wayfinder`。备份时应同时备份 `wayfinder.sqlite` 和 `pi-sessions.sqlite`；在线复制需使用 SQLite 在线备份 API 或短暂停服，不能只复制主文件而忽略 WAL。

验证：

```bash
systemctl status wayfinder
curl --fail http://127.0.0.1:3030/health/live
curl --fail http://127.0.0.1:3030/health/ready
journalctl -u wayfinder --since today
```

回滚：停止服务，恢复上一版 `/opt/wayfinder` 和同一时间点的两个数据库备份，再启动并检查 ready 端点。数据库迁移只允许向前执行；程序发现比自身更高的 Schema 版本会拒绝启动。

飞书使用出站长连接，不需要在路由器或 NAS 防火墙上开放管理端口。不要为了 Docker 状态把 `wayfinder` 加入 `docker` 组；先部署独立的只读代理，再在后续版本中接入。
