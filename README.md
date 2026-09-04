# J2Agent AI Website

基于 Vue 3 + Vite 的 J2Agent 门面网站，视觉与 `j2agent-ui` 保持一致。

## 本地运行

```bash
npm ci
npm run dev
```

## 构建

```bash
npm run build:dist
```

构建产物输出到 `dist/`。推送到 `main` 或 `master` 后，`.github/workflows/deploy.yml` 会自动构建并部署到 GitHub Pages。

门户文档中心使用内置 Markdown 索引，正文通过 `raw.githubusercontent.com` 读取 `j2agent-ai/j2agent-docs`，不依赖 GitHub REST API，因此不会受到匿名 API 速率限制影响。

首次启用时，在 GitHub 仓库的 Settings → Pages → Build and deployment 中将 Source 设置为 GitHub Actions。
