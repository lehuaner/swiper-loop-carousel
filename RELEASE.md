# 发布教程

## 前置条件

- GitHub 仓库：`lehuaner/swiper-loop-carousel`（public）
- NPM 包名：`@lehuan/swiper-loop-carousel`
- 本地已安装 `gh` CLI 并登录 GitHub
- 本地已登录 NPM（`npm login`）

## 一键发布（推荐）

```bash
# 1. 进入包目录
cd packages/swiper-loop-carousel

# 2. 一键发布 patch 版本
npm run release:patch
```

这条命令会自动完成三步：

| 步骤 | 说明 |
|------|------|
| `npm version patch` | package.json 版本号 +1（如 1.3.3 → 1.3.4），创建 git tag |
| `git push --follow-tags` | 推送代码和 tag 到 GitHub |
| `gh release create` | 在 GitHub 创建 Release，标记为 Latest |

### 触发 GitHub Action → 自动发布到 NPM

tag 推送后，GitHub Action（`.github/workflows/publish.yml`）自动执行：

1. 检出代码
2. `npm ci` 安装依赖
3. `npm run build` 构建
4. 检查该版本是否已在 NPM 存在
5. 不存在则 `npm publish` 自动发布

> **如果 Action 失败**：通常是 `NPM_TOKEN` 密钥配置问题。检查仓库 Settings → Secrets and variables → Actions 中是否有 `NPM_TOKEN`。

## 发布 minor / major 版本

```bash
# minor：1.3.x → 1.4.0（新增功能，向后兼容）
npm run release:minor

# major：1.x.x → 2.0.0（不兼容变更）
npm run release:major
```

## 手动发布（不经过 GitHub Action）

```bash
cd packages/swiper-loop-carousel

# 1. 构建
npm run build

# 2. 发布到 NPM
npm publish --access public

# 3. 创建 git tag
git tag v$(node -e "console.log(require('./package.json').version)")

# 4. 推送 tag
git push origin v$(node -e "console.log(require('./package.json').version)")

# 5. 创建 GitHub Release
gh release create v$(node -e "console.log(require('./package.json').version)") --title "v$(node -e "console.log(require('./package.json').version)")" --notes "版本说明" --latest
```

## 发布检查清单

- [ ] 代码已提交并推送
- [ ] `npm run build` 构建成功
- [ ] `package.json` 版本号正确
- [ ] NPM Token 在 GitHub Secrets 中有效
- [ ] GitHub Action 运行通过
- [ ] NPM 上确认新版本已发布：`npm view @lehuan/swiper-loop-carousel version`

## 如果发布失败了

**情况 1：NPM 提示需要登录**

确保已配置 `NPM_TOKEN`：

1. 去 https://www.npmjs.com/settings/lehuan/tokens 创建 token（权限：Read and Publish）
2. 去 https://github.com/lehuaner/swiper-loop-carousel/settings/secrets/actions 添加 `NPM_TOKEN`

**情况 2：版本已存在**

NPM 不允许重复发布同一个版本。`npm run release:patch` 会自动 bump 版本，不会撞车。如果手动指定了版本号，确认该版本在 NPM 上不存在。

## 附录：完整工作流

```
本地命令                                GitHub / NPM
──────────────────────────────────────────────────────────
npm run release:patch
  │
  ├─→ npm version patch
  │     ├─→ package.json version 1.3.3 → 1.3.4
  │     └─→ 创建 git tag v1.3.4
  │
  ├─→ git push --follow-tags
  │     ├─→ 推送到 GitHub
  │     └─→ tag 触发 GitHub Action
  │
  └─→ gh release create
        └─→ GitHub Release 创建
              │
              ▼
        GitHub Action 启动
          ├─→ npm ci
          ├─→ npm run build
          ├─→ npm view 检查版本是否存在
          └─→ npm publish → NPM
                              │
                              ▼
                        @lehuan/swiper-loop-carousel@1.3.4
```
