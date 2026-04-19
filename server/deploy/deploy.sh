#!/bin/bash
# Jasmine Counseling Studio - 腾讯云一键部署脚本
# 执行方式：bash deploy.sh

set -e

echo "=========================================="
echo "茉莉心理工作室 - 腾讯云部署脚本"
echo "=========================================="

# ── 配置 ────────────────────────────────────────────────
APP_NAME="jasmine-studio"
APP_DIR="/var/www/jasmine"
DB_DIR="$APP_DIR/db"
LOG_DIR="/var/log/jasmine"
PORT=3001

# ── 系统依赖 ────────────────────────────────────────────
echo "[1/6] 检查系统依赖..."
which nginx > /dev/null || echo "⚠️ 请安装 nginx: apt install nginx"
which pm2 > /dev/null || echo "⚠️ 请安装 PM2: npm install -g pm2"

# ── 目录创建 ────────────────────────────────────────────
echo "[2/6] 创建目录..."
sudo mkdir -p $APP_DIR
sudo mkdir -p $DB_DIR
sudo mkdir -p $LOG_DIR
sudo mkdir -p /var/www/jasmine/h5

# ── 代码拉取 ────────────────────────────────────────────
echo "[3/6] 拉取代码..."
if [ -d "$APP_DIR/.git" ]; then
    cd $APP_DIR && git pull
else
    git clone https://github.com/wanoukaka/Jasmine-Counseling-Studio.git $APP_DIR
fi

# ── 前端构建/复制 ──────────────────────────────────────
echo "[4/6] 部署前端..."
cp -r $APP_DIR/h5/* /var/www/jasmine/h5/
echo "✅ 前端已部署到 $APP_DIR/h5"

# ── PM2 启动后端 ───────────────────────────────────────
echo "[5/6] 启动后端服务..."
cd $APP_DIR/server
pm2 stop $APP_NAME 2>/dev/null || true
pm2 delete $APP_NAME 2>/dev/null || true
pm2 start ecosystem.config.cjs --name $APP_NAME
pm2 save

# ── Nginx 配置 ──────────────────────────────────────────
echo "[6/6] 配置 Nginx..."
sudo cp $APP_DIR/server/deploy/nginx.conf /etc/nginx/sites-available/jasmine.conf
sudo ln -sf /etc/nginx/sites-available/jasmine.conf /etc/nginx/sites-enabled/jasmine.conf
sudo nginx -t && sudo nginx -s reload

echo ""
echo "=========================================="
echo "✅ 部署完成！"
echo "=========================================="
echo "前端访问：http://<服务器IP>/"
echo "后端API：http://<服务器IP>/api/"
echo ""
echo "管理命令："
echo "  pm2 logs $APP_NAME     # 查看后端日志"
echo "  pm2 restart $APP_NAME   # 重启后端"
echo "  nginx -t && nginx -s reload  # 重载Nginx"
