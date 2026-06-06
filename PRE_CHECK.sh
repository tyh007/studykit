#!/bin/bash
# StudyKit 生产部署 — 自动预检查脚本
# 检查所有必要的配置和依赖

set -e

echo "════════════════════════════════════════════════════════════"
echo "  StudyKit 生产部署 - 自动预检查"
echo "════════════════════════════════════════════════════════════"
echo ""

PASS=0
WARN=0
FAIL=0

# 颜色
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

check() {
  if eval "$1" > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} $2"
    ((PASS++))
  else
    echo -e "${RED}✗${NC} $2"
    ((FAIL++))
  fi
}

warn() {
  echo -e "${YELLOW}⚠${NC} $1"
  ((WARN++))
}

# 检查项
echo "📋 检查项..."
echo ""

# 1. 检查 .env
check "[ -f .env ]" ".env 文件存在"
check "grep -q 'DB_PASSWORD=' .env" "DB_PASSWORD 已配置"
check "grep -q 'JWT_SECRET=' .env" "JWT_SECRET 已配置"
check "grep -q 'RATE_LIMIT' .env" "速率限制已配置"

# 2. 检查 Docker
echo ""
check "command -v docker" "Docker 已安装"
check "command -v docker-compose" "Docker Compose 已安装"

# 3. 检查文件
echo ""
check "[ -f docker-compose.yml ]" "docker-compose.yml 存在"
check "[ -f docker-compose.nas.yml ]" "docker-compose.nas.yml 存在"
check "[ -d backend ]" "backend 目录存在"
check "[ -d frontend ]" "frontend 目录存在"

# 4. 检查凭证强度
echo ""
if grep -q "DB_PASSWORD=.*.\{44\}" .env; then
  echo -e "${GREEN}✓${NC} DB_PASSWORD 长度充足（44 字符）"
  ((PASS++))
else
  warn "DB_PASSWORD 长度可能不足"
fi

if grep -q "JWT_SECRET=.*.\{64\}" .env; then
  echo -e "${GREEN}✓${NC} JWT_SECRET 长度充足（64 字符）"
  ((PASS++))
else
  warn "JWT_SECRET 长度可能不足"
fi

# 5. 检查 .gitignore
echo ""
check "grep -q '^\.env$' .gitignore" ".env 在 .gitignore 中"

# 6. 检查网络
echo ""
check "ping -c 1 8.8.8.8 > /dev/null 2>&1" "网络连接正常"

# 总结
echo ""
echo "════════════════════════════════════════════════════════════"
echo ""

if [ $FAIL -eq 0 ]; then
  echo -e "${GREEN}✅ 预检查通过！($PASS 项检查)${NC}"
  if [ $WARN -gt 0 ]; then
    echo "   ($WARN 项警告)"
  fi
  exit 0
else
  echo -e "${RED}❌ 预检查失败！${NC}"
  echo "   失败: $FAIL 项"
  echo "   通过: $PASS 项"
  exit 1
fi
