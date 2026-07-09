# GitHub Push + Local Docker Preview

这份文档用于每次改完 StudyKit 后，重复执行：

1. 提交并 push 到 GitHub。
2. 重新构建并部署到本地 Docker，方便在浏览器预览。

默认项目目录：

```bash
cd "/Users/hengx/Library/CloudStorage/OneDrive-Personal/School Works/BSc Y1 T1 & T2/Personal Projects/studykit"
```

默认预览地址：

```text
http://localhost:8080/
```

Backend API：

```text
http://localhost:3001/
```

## 只重新部署本地 Docker

如果代码已经是你想预览的版本，不需要 commit/push，只要重新构建本地 Docker：

```bash
cd "/Users/hengx/Library/CloudStorage/OneDrive-Personal/School Works/BSc Y1 T1 & T2/Personal Projects/studykit"

docker compose up -d --build
docker compose ps
```

验证前端和后端：

```bash
curl -I http://localhost:8080/
curl -s -o /tmp/studykit-api-check.txt -w '%{http_code}\n' http://localhost:3001/api/auth/me
```

说明：

- 前端返回 `200` 表示本地预览正常。
- `/api/auth/me` 未登录时返回 `401` 是正常的，说明 backend 活着。
- 打开 `http://localhost:8080/` 后登录即可预览。

## Push 到 GitHub 并部署本地 Docker

每次完成一轮开发后，执行下面这组命令。

把提交信息改成你这次改动的简短说明：

```bash
cd "/Users/hengx/Library/CloudStorage/OneDrive-Personal/School Works/BSc Y1 T1 & T2/Personal Projects/studykit"

git status --short --branch
git add -A
git commit -m "Describe your change"
git push -u origin "$(git branch --show-current)"

docker compose up -d --build
docker compose ps

curl -I http://localhost:8080/
curl -s -o /tmp/studykit-api-check.txt -w '%{http_code}\n' http://localhost:3001/api/auth/me
```

## 推荐的完整发布检查

如果是比较大的改动，先跑检查，再提交：

```bash
cd "/Users/hengx/Library/CloudStorage/OneDrive-Personal/School Works/BSc Y1 T1 & T2/Personal Projects/studykit"

cd frontend
npm run typecheck
npm test

cd ../backend
npm test

cd ..
git status --short --branch
git add -A
git commit -m "Describe your change"
git push -u origin "$(git branch --show-current)"

docker compose up -d --build
docker compose ps
```

## 查看日志

如果页面打不开或功能异常，先看容器状态：

```bash
docker compose ps
```

查看 backend 日志：

```bash
docker compose logs --tail=120 backend
```

查看 frontend 日志：

```bash
docker compose logs --tail=120 frontend
```

持续跟随日志：

```bash
docker compose logs -f backend frontend
```

## 停止本地预览

只停止容器，不删除数据库和上传文件：

```bash
docker compose stop
```

重新启动已有容器：

```bash
docker compose up -d
```

## 注意事项

- 不要随便运行 `docker compose down -v`，它会删除 Docker volume，可能清空本地数据库和上传文件。
- 如果端口被占用，默认端口是 frontend `8080`、backend `3001`、Postgres `5433`。
- 如果 `git push` 失败，通常是 GitHub 登录凭据问题。先修复本机 Git/GitHub 认证，再重新运行 push 命令。
- 如果数据库新增表，backend 启动时会通过 `backend/init-db.js` 自动补齐缺失表和索引。
