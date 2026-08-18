# 运维、备份与迁移

## 日常可用性基线

- HA 宿主允许长期开机并关闭自动睡眠。
- 如果使用虚拟机，配置随宿主启动并在异常退出后自动重启。
- HA 使用路由器 DHCP 保留地址，不在 HA 内硬编码容易冲突的静态地址。
- 外接硬盘必须是稳定供电、不会自动卸载的 SSD；HA VM 运行盘与备份盘最好分离。
- 路由器、HA 宿主和关键网关建议接 UPS。

## 备份策略

### HA 完整备份

- 每日自动备份，保留最近 7 份。
- 每周复制一份到 HA 主机以外的位置。
- 每月验证一次备份可读取，并记录 HA OS/Core 版本。
- 集成大升级、修改网络、重建 HomeKit Bridge 前手动备份。

### Git 仓库

- 稳定配置变更按功能提交。
- 不提交运行时状态和凭证。
- 发布前审查 diff，尤其检查实体 ID、危险动作与密钥。

## 更新策略

1. 阅读 HA、Xiaomi Home 和自定义组件发布说明。
2. 创建 HA 完整备份。
3. 先更新次要组件，再更新 HA Core/OS；一次只改变一层。
4. 回归温湿度、扫地、回充、HomeKit、Assist 和自动化。
5. 观察日志后再清理旧版本。

Intent Router App 更新保持手动确认：代码通过 CI 后同步提升 `intent-router/package.json` 与 App `config.yaml` 的版本，GitHub 发布 `amd64`/`aarch64` 镜像，HA App 页面出现更新提示。更新前创建 HA 备份，更新后先在测试台保持调试模式完成只读与 dry-run 回归，再恢复真实执行。不要覆盖同一个版本标签发布不同代码。

不要把“升级成功启动”当作业务验收完成。

## 故障定位顺序

1. HA 页面能否访问。
2. 实体是 `available` 还是 `unavailable`。
3. 直接在 HA 开发者工具调用能力脚本是否成功。
4. 集成日志是否有厂商/网络错误。
5. HomeKit 或 Intent Router 是否只是在输入侧失败。
6. 对比最近配置变更和版本更新。

这能快速区分：设备问题、HA 适配问题、能力脚本问题、输入源问题。

## 关键健康检查

- HA HTTP 可达。
- Supervisor、Core、Xiaomi Home 集成正常。
- 关键实体最近更新时间没有超阈值。
- HomeKit Bridge 已配对且 mDNS 可达。
- Intent Router（启用后）能读取 HA 健康状态。
- 磁盘剩余空间、备份成功时间和 VM 运行状态正常。

Intent Router 代码更新后执行：

```bash
cd intent-router
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
```

本地验证通过后提升 App 版本并发布；HA 更新 App 后检查 `/healthz`、HA 自动发现状态和至少一项只读能力。GitHub Actions 会对 Router、契约、配置和语句用例变更执行同一组检查并构建多架构镜像；生产环境仍需单独验收真实设备状态。

## 迁移到新 HA 主机

迁移主路径是“旧 HA 完整备份 → 新 HAOS onboarding 恢复”，不是复制虚拟磁盘。具体的树莓派/独立主机安装、网络切换、USB 协调器、HomeKit、Intent Router App 恢复和回滚步骤见：[从虚拟机迁移到独立 HA 主机](migration-to-dedicated-ha.md)。

无论目标硬件是什么，都必须满足：

1. 备份文件和 emergency kit 已保存在旧 HA 主机之外。
2. 目标可用空间大于旧系统实际磁盘占用。
3. 切换前关闭旧 VM；两套 HA 不共享同一 IP、HomeKit Bridge 或无线协调器。
4. 新主机完整验收并创建新备份后，旧 VM 才转为纯回滚副本。

## 灾难恢复优先级

1. 恢复 HA 与设备状态。
2. 恢复本地自动化和 HomeKit 快速控制。
3. 恢复 Intent Router。
4. 最后恢复 OpenClaw、外部 AI 和非关键展示。
