# 实施状态

## 已完成：Phase 0 + Phase 1 可运行代码基线

- TypeScript/Node 22、格式检查、静态检查、测试、构建和 GitHub CI。
- 飞书出站长连接、用户/群白名单、群聊 @ 校验、事件去重和有界背压。
- Pi Agent Core、Pi AI、独立 SQLite 会话后端、会话隔离、上下文裁剪和进度消息。
- 五个只读工具、固定命令边界、结构化输出、脱敏和审计。
- 业务 SQLite 的最小表模型与健康检查。
- systemd 生产单元和明确受限的开发 Compose 示例。

## 仍需实机验收或补齐

- 在 Debian/FNOS 上验证固定命令路径、低权限 `iw`/`df` 访问和 SQLite WAL 行为。
- 当前 SMART、内核 I/O、Wi-Fi 网关连通性尚未采集。
- Docker 状态在独立安全只读代理完成前会安全降级为 `unavailable`；不会通过 docker 组或 socket 绕过。
- 真实飞书/模型配置、长连接与回答准确性尚未验证，因此 Phase 1 的生产验收尚未完成。

## 启用前待用户提供

- 飞书应用凭证和事件订阅配置。
- 云端模型供应商、模型 ID 和 API Key。
- 允许的飞书用户角色，以及是否启用指定群聊。
- NAS 上 Node.js、Docker CLI、Compose 和相关系统命令的实际路径。

## 后续阶段

- Phase 2：审批票据、确认卡片、白名单容器重启和备份任务。
- Phase 3：健康检查调度、告警去重、恢复通知和每日摘要。
- Phase 4：本地 watchdog 和自动回滚验证完成后，再考虑 Wi-Fi 重连。
