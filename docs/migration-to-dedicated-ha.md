# 从虚拟机迁移到独立 HA 主机

本手册适用于把当前 HAOS 虚拟机迁移到树莓派、Home Assistant Green、通用 x86 小主机或其他受支持的 Home Assistant OS 设备。核心方法不是复制虚拟磁盘，而是：旧 HA 创建完整备份，新设备首次引导时恢复该备份。

Home Assistant 官方明确支持在新设备的 onboarding 阶段上传旧设备备份，源设备和目标设备可以是不同硬件类型。备份默认加密；迁移前必须同时保存备份文件和 emergency kit：<https://www.home-assistant.io/common-tasks/general/#restoring-a-backup>。

## 推荐拓扑

| 组件 | 推荐位置 | 原因 |
|---|---|---|
| Home Assistant OS | 独立主机或树莓派 | 长期开机、设备协议和状态权威 |
| Intent Router | 同一 HAOS 内的独立 HA App | 随 HA 启动和迁移，同时与 HA Core 保持容器隔离 |
| MiniMax/OpenClaw | 外部输入与语义服务 | 不持有厂商凭证，不成为设备中枢 |

Router 不进入 HA Core 容器。它以独立 App 运行，由 Supervisor 管理；因此同机部署不等于同进程部署。视频转码或本地大模型等重负载以后仍可拆到其他机器，Intent Router 本身保持轻量。

## 迁移前记录

在旧 HA 中记录但不要提交到 Git：

- HA OS、Core、Supervisor 版本和当前磁盘占用。
- 旧 HA 的 IP、MAC、主机名和路由器 DHCP 保留规则。
- Zigbee、Thread、Z-Wave 等 USB 协调器型号、连接方式和设备路径。
- HomeKit Bridge 是否正常配对，以及 Apple 家庭当前可见实体。
- Xiaomi Home、Matter、摄像头和其他云集成是否需要再次登录。
- Intent Router App 版本、8787 端口和 OpenClaw 共享密钥的保存位置。

目标磁盘的可用空间应大于旧系统实际已用空间；不要只比较备份压缩包大小。官方检查入口是“设置 → 系统 → 修复 → 系统信息”。

## 第一步：准备可恢复备份

1. 在旧 HA 执行“设置 → 系统 → 备份 → 立即备份 → 手动备份”。
2. 选择所有配置、目录和 Apps，创建用于迁移的完整备份。
3. 下载 `.tar` 备份到 HA 主机以外的位置。
4. 下载并离线保存该备份对应的 emergency kit；没有解密密钥可能无法恢复加密备份。
5. 再保留一份异地或 NAS 副本，并确认文件能够读取。
6. 记录备份时间；从此到正式切换之间尽量不要再修改自动化、设备和配对。

## 第二步：安装目标 HAOS

树莓派 4/5 建议使用官方 64 位 HAOS 镜像、可靠电源和有线网络。官方安装流程使用 Raspberry Pi Imager，并要求至少 2 GB 内存和 32 GB 存储：<https://www.home-assistant.io/installation/raspberrypi/>。

长期运行仍建议使用可靠 SSD、稳定供电和 UPS，避免把高频数据库写入长期压在普通 microSD 上。通用 x86 小主机同样优先直接安装 HAOS。

1. 写入与目标硬件匹配的 HAOS 镜像。
2. 接入有线网络，但暂时不要给新主机分配旧 HA 的 IP。
3. 如果沿用原 Zigbee/Z-Wave USB 协调器，先关闭旧 VM，再把协调器插到新主机。
4. 打开新 HA 的首次欢迎页面，选择“上传备份”，不要创建一个全新的家庭。
5. 上传备份、选择全部恢复，并输入 emergency kit 中的解密密钥。
6. 等待恢复完成；大型安装可能需要较长时间，期间不要刷新或断电。
7. 使用旧 HA 的用户名和密码登录。

## 第三步：切换网络

最省事的方法是让新 HA 接管旧 HA 的局域网 IP：

1. 确保旧 VM 已完全关机。
2. 在路由器中把旧 DHCP 保留地址绑定到新主机 MAC。
3. 让新主机重新获取地址，确认 `http://旧地址:8123` 可以打开。
4. 不要让新旧 HA 同时使用同一 IP、同一 HomeKit Bridge 身份或同一无线协调器。

如果不能保留旧 IP，则更新所有依赖 HA 地址的配置，至少包括：

- 反向代理、VPN、书签和 Companion App 内部地址。
- OpenClaw 中的 Intent Router URL。
- 防火墙中允许访问 HA 8123 的规则。

建议为 HA 主机设置稳定的局域网 DNS 名称或 DHCP 保留地址，HA 和 Router App 会共用这个主机地址。

## 第四步：恢复 Intent Router App

完整备份应包含 Intent Router App 及其配置。恢复后，App 内部通过 Supervisor 地址访问 HA，不依赖旧 IP，也不需要重新创建 HA Token：

```text
OpenClaw → 新 HA 主机:8787 → Intent Router App
Intent Router App → http://supervisor/core → Home Assistant
```

1. 在“设置 → Apps”确认 Intent Router 已恢复且版本正确；若备份未包含 App，从 `hudk-home` 仓库重新安装。
2. 检查 MiniMax Key、`shared_secret`、默认调试和真实执行开关是否恢复。
3. 启动 App，先检查 `/healthz` 和 HA 自动发现；运行时目录会从恢复后的 HA 重建。
4. 保持 `default_dry_run: true`，验收温湿度、扫地和回充解析。
5. 需要真实控制时再开启 `allow_live_execution`，并测试一项低风险写操作。
6. OpenClaw 改为访问 `http://新_HA_IP:8787/v1/turn`；如果沿用旧 IP，则无需修改。
7. 不要同时启动旧、新两套 Router 接受真实写请求。

## 第五步：设备与配对验收

按下面顺序检查，发现上游失败时先不要重建下游：

1. HA 页面、Supervisor、磁盘和备份状态。
2. Xiaomi Home 与温湿度/扫地机实体是否 `available`。
3. 在 HA 开发者工具直接调用 `script.hudk_vacuum_start` 和 `script.hudk_vacuum_dock`。
4. HomeKit Bridge 和 Siri。完整恢复通常会带回运行状态，但先检查 mDNS 和网络，不要一看到离线就删除 Bridge 重配。
5. Zigbee/Z-Wave：沿用同一协调器时先检查设备路径；换协调器时使用对应集成的迁移流程，不要直接重置所有终端设备。
6. Matter/Thread：确认边界路由器和 Fabric 状态，再判断是否需要重新配网。
7. Router 健康查询、HA 页面 dry-run、温湿度查询。
8. 最后才开启 Router 真实执行许可，分别用显式 `dry_run: false` 验收扫地和回充的状态回读。

## 回滚方案

迁移后一周内保留旧 VM 和迁移前备份，但保持旧 VM 关机。

如果新主机无法稳定运行：

1. 关闭新 HA，拔下共享的 USB 协调器。
2. 把 DHCP 保留规则恢复给旧 VM。
3. 将协调器重新连接旧宿主并启动旧 VM。
4. 验证 HA、设备、HomeKit 和 Intent Router App；若 IP 变化，再更新 OpenClaw 的 Router URL。

回滚期间也不能同时启动两套拥有同一 IP、HomeKit Bridge 或无线协调器的 HA。

## 迁移完成标准

- 新 HA 连续稳定运行至少 24 小时，时间、磁盘和网络正常。
- 温湿度、扫地、回充、HomeKit/Siri 和关键自动化均通过。
- Router 从 HA 页面 dry-run 通过，真实写操作有 HA 状态回读。
- 新主机已创建一次新的完整备份，并复制到主机外。
- 路由器 DHCP、设备清单和本地运维记录已更新。
- 旧 VM 保留为关机回滚副本，不再参与正常运行。
