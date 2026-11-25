# StudyKit NAS 部署

本页汇总 Docker 与 NAS 部署资料。[项目 README](README.md) 提供本地开发、桌面构建和 Alpha 验收入口。

首次部署时，将 `.env.example` 复制为 `.env`，分别为 `DB_PASSWORD` 和 `JWT_SECRET` 生成独立值，并按部署环境配置数据目录与访问地址。旧文档中曾记录的凭据如仍在使用，应按现有 PostgreSQL 和会话配置轮换。

- [NAS 部署步骤](PRODUCTION_SETUP.md)
- [上线检查清单](PRODUCTION_CHECKLIST.md)
- [部署架构与故障排查](DEPLOYMENT.md)
