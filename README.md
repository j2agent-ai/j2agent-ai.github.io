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

构建产物输出到 `dist/`。推送到 `main` 或 `master` 后，`.github/workflows/deploy.yml` 会自动构建，并将构建产物发布到 GitHub 的 `dist` 分支。

门户文档中心使用内置 Markdown 索引，正文通过 `raw.githubusercontent.com` 读取 `j2agent-ai/j2agent-docs`，不依赖 GitHub REST API，因此不会受到匿名 API 速率限制影响。

## AI 问答

门户复用了参考站点中的 `knowledge_qa_assistant`：知识库问答浮窗、WebSocket 流式输出、Agent 思考状态、来源文件、Markdown/图表预览和主动停止任务均已接入。部署前请在 GitHub 仓库 Secrets 中配置 `VITE_J2AGENT_API_KEY`，流水线会在构建时注入；不要把 API Key 写入源码。

如果使用 GitHub Pages，在仓库 Settings → Pages → Build and deployment 中将 Source 设置为 `Deploy from a branch`，分支选择 `dist`，目录选择 `/ (root)`。
