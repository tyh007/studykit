# StudyKit

StudyKit 是用于课程学习和论文研究的工作区。Web 版可连接独立的 API 和 PostgreSQL。

## 本地开发

在 `frontend/` 安装依赖并启动 Vite。

```sh
cd frontend
npm ci
npm run dev
```

打开 `http://localhost:5173`。需要 Web API 和数据库时，在仓库根目录运行 `docker compose up --build`。Compose 的 Web 入口为 `http://localhost:8080`，API 端口为 `3001`，Vite 默认将 API 请求代理到该端口。

## 桌面版

在包含 `frontend/src-tauri/package.json` 的 v0.4 检出中，先在 macOS 安装 Rust 和 Xcode Command Line Tools，再从 `frontend/` 运行以下命令。

```sh
npm --prefix src-tauri ci
npm run desktop:dev
npm run desktop:bundle
```

## 验证和文档

- Web 检查在 `frontend/` 运行 `npm run typecheck`、`npm test` 和 `npm run build`。Node 25 下可用 `NODE_OPTIONS=--no-experimental-webstorage npm test` 让 Vitest 使用浏览器测试环境的存储实现。
- API 测试在 `backend/` 安装依赖后运行 `npm test`。
- v0.4 的规格、架构和实施报告从 `studykit_v0.4_document_index_cn.md` 查阅。桌面 Alpha 的任务与验收条件见 `studykit_v0.4_wp11_alpha_test_kit_cn.md`。
- NAS 部署见 [部署入口](README_PRODUCTION.md)。
