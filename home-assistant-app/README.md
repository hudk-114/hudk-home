# Home Assistant App 发布

当前公开仓库同时保存 Router 源码和 Home Assistant App 清单。根目录的 `repository.yaml` 让 HA App Store 能直接添加 `https://github.com/hudk-114/hudk-home`；真实家庭配置和密钥始终保存在被忽略的本地文件或 HA App 配置中。

## 版本发布

1. 修改并测试仓库中的 Router；本地 `.env` 和 HA App 密钥不得提交。
2. 同时更新源码侧 `../intent-router/package.json` 和本目录下 `intent-router/config.yaml` 的版本。
3. 更新本目录下 `intent-router/CHANGELOG.md`。
4. 推送 `main` 后等待 `Intent Router` workflow 发布两个架构和通用 manifest。
5. 在 HA App Store 点击“检查更新”，先备份再手动更新。

不要复用已有版本标签承载不同代码。当前版本对应：

```text
ghcr.io/hudk-114/hudk-home-intent-router:<version>
```

首次发布镜像后，将 GHCR 包 `hudk-home-intent-router` 的可见性设置为 Public。之后源码、App 版本和更新入口都在同一仓库维护，不需要同步第二份代码或清单。
