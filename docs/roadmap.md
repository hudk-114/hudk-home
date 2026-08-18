# 实施路线图

## 当前已验证基线

- [x] Xiaomi Home 已接入环境传感器与主扫地机器人
- [x] HomeKit Bridge 已接入 Apple 家庭
- [x] Siri 可触发扫地机器人开始清扫
- [x] Siri 可触发扫地机器人回充
- 当前扫地机能力范围为 `vacuum.start` 与 `vacuum.dock`；暂不规划暂停能力

## 近期待办

### 1. OpenClaw 控制家庭能力

- [x] 实现统一文本入口，接受经过认证的 `source: openclaw` 请求
- [x] 首批只开放 `vacuum.start`、`vacuum.dock`、环境数据查询和系统健康查询
- [x] OpenClaw 不持有厂商凭证，不提交或生成 HA service/entity ID
- [x] 审计记录能够关联 OpenClaw 请求、规范化意图、能力和 HA context
- [x] HA 或设备不可用时返回真实失败，不缓存写操作等待补执行
- [ ] 在实际 OpenClaw 实例中配置 HTTP 工具并完成真实链路验收

完成标准：OpenClaw 可以发起开始扫地、回充和温湿度查询；所有写操作只经过能力白名单，并能从 HA 状态验证结果。

### 2. AI 意图识别层

- [x] 实现独立 Intent Router，规则优先，AI 仅作语义兜底
- [x] 接入可配置 AI Provider，首个 Provider 为 MiniMax/OpenAI-compatible
- [x] 所有模型输出通过 `contracts/intent.schema.json` 校验
- [x] 实现置信度阈值、目标澄清、超时、重试、熔断和 dry-run
- [x] 禁止模型生成或传递任意 HA service/entity ID
- [x] 用 `tests/utterances.yaml` 回归明确、歧义和拒绝场景
- [x] 从 HA 标签自动发现通用 Router 设备实例，并用安全模板生成运行时能力
- [x] 使用真实 MiniMax M3 Key 验收模糊表达、tool calling、关闭推理与格式校验
- [ ] 完成生产限流与故障注入验收
- [x] 测试台支持调试/真实执行切换，并展示脱敏后的 LLM 原始请求体

完成标准：高频命令不调用 AI；模糊表达可映射到白名单能力；歧义、未知目标和非法参数不会执行。

### 3. 接入萤石云视频

- [ ] 核对 CS-C6C、CS-C7 的具体子型号、固件和 RTSP/ONVIF 能力
- [ ] 优先使用局域网 RTSP/ONVIF 视频流，必要控制能力再使用 EZVIZ 集成
- [ ] 将摄像头画面接入 HA Dashboard，验证连续播放、重连和断网行为
- [ ] 评估是否需要暴露给 Apple 家庭；默认不向 AI 暴露实时视频
- [ ] 设备验证码、账号、视频地址和访问凭证仅保存在本地 Secret

完成标准：HA 能稳定展示两台摄像头的视频；本地视频不因萤石云短时不可用而中断，失败时能明确区分视频流、设备和云端故障。

### 4. 接入宠物设备

- [ ] 建立小佩、霍曼等设备的本地设备清单，记录准确型号、使用 App 和地区
- [ ] 按官方集成、本地协议、维护活跃的社区集成、厂商云依次评估
- [ ] 第一阶段只接入状态、耗材、缺粮缺水和故障提醒
- [ ] 喂食等写操作单独定义安全等级、允许来源、能力白名单和确认策略
- [ ] 验证断网、重复调用、设备离线和状态回读，避免重复投喂

完成标准：受支持设备的状态能够稳定进入 HA；任何喂食动作都不能由 AI 直接调用厂商接口，并有真实状态或可审计结果作为成功依据。

## 阶段 0：运行基线

- [ ] HAOS 长期稳定运行
- [x] HA 局域网访问
- [x] Xiaomi Home 集成
- [x] 环境传感器与扫地机完成接入验收
- [x] HomeKit Bridge 基本链路
- [x] Siri 触发扫地与回充动作
- [ ] 路由器为 HA 设置 DHCP 保留地址
- [ ] 配置自动 HA 备份与 VM 自启动

## 阶段 1：能力标准化

- [ ] 部署仓库版 `hudk_vacuum_start` 和 `hudk_vacuum_dock`
- [ ] 删除旧测试按钮和重复脚本
- [ ] 确认温湿度实体 ID，并只登记在本地设备清单
- [ ] HomeKit Bridge 只暴露四个必要实体/脚本
- [ ] 为 Siri 建立自然的 Apple 场景名称
- [ ] 完成断网、离线、重启回归

## 阶段 2：本地语音语义

- [ ] 部署 HA Assist 中文自定义句式
- [x] 从 HA 设备与区域注册表同步设备别名和房间别名
- [x] 用 `tests/utterances.yaml` 和自动化测试回归明确、歧义与拒绝表达
- [x] 让明确命令完全不依赖外部 AI

## 阶段 3：独立 Intent Router

- [x] 实现 `/v1/turn`、`/v1/intent/resolve`、`/v1/command` 与 `/v1/confirm`
- [x] 加载 JSON Schema、能力白名单和本地覆盖配置
- [x] 实现规则优先路由
- [x] 实现 HA 实体、动作、标签和可选 Conversation 暴露同步与别名路由
- [x] 接入 MiniMax OpenAI-compatible tool calling 适配器
- [x] 实现超时、重试、熔断、dry-run 和审计
- [ ] 以专用 HA token 调用稳定脚本

## 阶段 4：多输入源

- [x] OpenClaw 使用统一文本 HTTP 契约
- [ ] OpenClaw 实例完成实际工具配置与验收
- [ ] iOS 快捷指令“询问家庭”
- [ ] HA Assist 对话代理适配
- [x] 统一返回可读执行结果和澄清问题

## 阶段 5：扩展设备与自动化

- [ ] 空调/新风/加湿除湿能力
- [ ] 洗衣与烘干完成提醒
- [ ] 照明、窗帘、人体和门窗传感器
- [ ] 离家、回家、睡眠场景
- [ ] 关键设备离线监控

## 每阶段完成定义

- 有文档和配置变更。
- 正常、重复、离线、超时场景均验证。
- 安全等级和暴露范围已审查。
- HA 完整备份成功。
- Git 变更已提交，且不含 secret。
