#!/bin/bash
# ================================================================
#  StudyKit 一键部署脚本
#  用法: bash deploy.sh
#  功能: 构建并启动所有 Docker 服务
# ================================================================

set -e

# ---- 颜色 ----
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# ---- 项目路径 ----
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

# ---- 头部 ----
echo ""
echo "════════════════════════════════════════════════════════════"
echo "  🚀 StudyKit 一键部署"
echo "════════════════════════════════════════════════════════════"
echo "  路径: $PROJECT_DIR"
echo ""

# ---- 前置检查 ----
check_dependency() {
  if ! command -v "$1" &>/dev/null; then
    echo -e "${RED}✗${NC} 缺少 $1，请先安装"
    exit 1
  fi
}

check_dependency docker

# ---- 1. 检查 .env ----
echo -e "${CYAN}[1/6]${NC} 检查环境配置..."

if [ ! -f ".env" ]; then
  if [ -f ".env.example" ]; then
    cp .env.example .env
    echo -e "  ${YELLOW}⚠${NC} 已从 .env.example 创建 .env，请编辑其中的密码和密钥"
    echo "  编辑完成后重新运行: bash deploy.sh"
    exit 1
  else
    echo -e "  ${RED}✗${NC} 缺少 .env 文件"
    exit 1
  fi
fi

# 检查关键配置项
DB_PASS=$(grep -E "^DB_PASSWORD=" .env | cut -d'=' -f2)
JWT_KEY=$(grep -E "^JWT_SECRET=" .env | cut -d'=' -f2)

if [ -z "$DB_PASS" ] || [ "$DB_PASS" = "change_me_in_production" ] || [ "$DB_PASS" = "studykit_dev_pass" ]; then
  echo -e "  ${YELLOW}⚠${NC} DB_PASSWORD 是默认值或为空，建议修改"
fi
if [ -z "$JWT_KEY" ] || [ "$JWT_KEY" = "change_me_in_production" ] || [ "$JWT_KEY" = "studykit_dev_pass" ]; then
  echo -e "  ${YELLOW}⚠${NC} JWT_SECRET 是默认值或为空，建议修改"
fi

# 确保生产模式
if ! grep -q "NODE_ENV=production" .env 2>/dev/null; then
  echo "NODE_ENV=production" >> .env
  echo -e "  ${YELLOW}⚠${NC} 已添加 NODE_ENV=production"
fi

echo -e "  ${GREEN}✓${NC} .env 配置正常"

# ---- 2. 清理旧构建缓存 ----
echo -e "${CYAN}[2/6]${NC} 清理构建缓存..."
docker builder prune -f 2>/dev/null || true
echo -e "  ${GREEN}✓${NC} 构建缓存已清理"

# ---- 3. 构建 Docker 镜像 ----
echo -e "${CYAN}[3/6]${NC} 构建 Docker 镜像..."
echo ""
docker compose build
echo ""
echo -e "  ${GREEN}✓${NC} 镜像构建完成"

# ---- 4. 停止旧容器 ----
echo -e "${CYAN}[4/6]${NC} 停止旧容器..."
docker compose down 2>/dev/null || true
echo -e "  ${GREEN}✓${NC} 旧容器已停止"

# ---- 5. 启动新容器 ----
echo -e "${CYAN}[5/6]${NC} 启动新容器..."
docker compose up -d
echo -e "  ${GREEN}✓${NC} 容器已启动"
echo ""

# ---- 6. 验证部署 ----
echo -e "${CYAN}[6/6]${NC} 验证部署..."
echo ""

# 等待服务就绪（最多等30秒）
MAX_WAIT=30
WAITED=0
while [ $WAITED -lt $MAX_WAIT ]; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/api/health 2>/dev/null || echo "000")
  if [ "$STATUS" = "200" ]; then
    break
  fi
  sleep 2
  WAITED=$((WAITED + 2))
done

# 健康检查
HEALTH=$(curl -s http://localhost:3001/api/health 2>/dev/null)
if echo "$HEALTH" | grep -q '"status":"ok"'; then
  echo -e "  ${GREEN}✓${NC} 后端 API 健康检查通过"
  echo -e "  ${GREEN}✓${NC} 数据库连接正常"
else
  echo -e "  ${RED}✗${NC} 后端健康检查失败"
  echo "  请查看日志: docker compose logs backend"
fi

# 前端检查
FRONTEND_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/ 2>/dev/null || echo "000")
if [ "$FRONTEND_STATUS" = "200" ]; then
  echo -e "  ${GREEN}✓${NC} 前端页面正常 (HTTP 200)"
else
  echo -e "  ${YELLOW}⚠${NC} 前端状态码: $FRONTEND_STATUS"
fi

# 容器状态
echo ""
echo -e "  ${GREEN}✓${NC} 容器运行状态:"
docker compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}" | while IFS= read -r line; do
  echo "    $line"
done

# ---- 完成 ----
echo ""
echo "════════════════════════════════════════════════════════════"
echo -e "  ${GREEN}✅ StudyKit 部署完成！${NC}"
echo "════════════════════════════════════════════════════════════"
echo ""
echo "  本地访问:"
echo "    前端:  http://localhost:8080"
echo "    API:   http://localhost:3001/api/health"
echo ""

# 获取本机 IP（macOS/Linux 兼容）
if command -v ipconfig &>/dev/null; then
  IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "")
elif command -v hostname &>/dev/null; then
  IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "")
fi
if [ -n "$IP" ]; then
  echo "  局域网访问（同网络其他设备）:"
  echo "    http://${IP}:8080"
  echo ""
fi

echo "  管理命令:"
echo "    查看日志:   docker compose logs -f"
echo "    停止服务:   docker compose down"
echo "    重启服务:   bash deploy.sh"
echo ""
echo "════════════════════════════════════════════════════════════"
echo ""
