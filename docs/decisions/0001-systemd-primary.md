# ADR 0001：生产部署使用 systemd

状态：已接受。

## 决策

Wayfinder 在 NAS 生产环境中直接以低权限 systemd 服务运行。Docker Compose 只用于开发和构建验证。

## 原因

只读工具需要观察 NAS 主机的网络接口和磁盘。普通容器默认只看到自己的网络、挂载和进程视图；扩大到 host network、host mounts 或 Docker socket 会显著削弱隔离，且 Docker socket 等价于高权限主机控制。systemd 能提供真实主机视图，同时使用独立用户、只读系统目录、能力清空和明确的可写数据目录限制权限。

## 后果

生产安装需要管理员创建用户、目录和 unit。若未来必须容器化，应先实现经过认证的只读主机代理，而不是直接挂载 Docker socket或整块主机文件系统。

