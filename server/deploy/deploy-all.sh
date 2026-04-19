#!/bin/bash
# 茉莉心理 + 童心惠民 - 腾讯云一键部署脚本
# 执行方式：bash deploy-all.sh

set -e

echo "=========================================="
echo "双项目部署 - 腾讯云一键脚本"
echo "=========================================="

# ── 配置 ────────────────────────────────────────────────
JASMINE_DIR="/var/www/jasmine"
CHILDHEART_DIR="/var/www/childheart"
LOG_DIR="/var/log/jasmine"

# ── 系统依赖 ────────────────────────────────────────────
echo "[1/8] 检查系统依赖..."
which nginx > /dev/null || { echo "❌ 请先安装 nginx: apt install nginx"; exit 1; }
which pm2 > /dev/null || { echo "❌ 请先安装 PM2: npm install -g pm2"; exit 1; }
echo "✅ 依赖检查通过"

# ── 目录创建 ────────────────────────────────────────────
echo "[2/8] 创建目录..."
sudo mkdir -p $JASMINE_DIR
sudo mkdir -p $CHILDHEART_DIR
sudo mkdir -p $LOG_DIR
sudo mkdir -p /var/www/jasmine/h5
sudo mkdir -p /var/www/jasmine/db
echo "✅ 目录创建完成"

# ── 拉取茉莉代码 ────────────────────────────────────────
echo "[3/8] 拉取茉莉心理代码..."
if [ -d "$JASMINE_DIR/.git" ]; then
    cd $JASMINE_DIR && git pull
else
    git clone https://github.com/wanoukaka/Jasmine-Counseling-Studio.git $JASMINE_DIR
fi
echo "✅ 茉莉代码拉取完成"

# ── 拉取童心代码 ────────────────────────────────────────
echo "[4/8] 拉取童心惠民代码..."
if [ -d "$CHILDHEART_DIR/.git" ]; then
    cd $CHILDHEART_DIR && git pull
else
    git clone https://github.com/wanoukaka/ChildHeart-Charity.git $CHILDHEART_DIR
fi
echo "✅ 童心代码拉取完成"

# ── 部署前端 ────────────────────────────────────────────
echo "[5/8] 部署前端静态文件..."
cp -r $JASMINE_DIR/h5/* /var/www/jasmine/h5/
cp -r $CHILDHEART_DIR/* /var/www/childheart/
echo "✅ 前端部署完成"

# ── PM2 启动服务 ────────────────────────────────────────
echo "[6/8] 启动 PM2 服务..."

# 茉莉后端
cd $JASMINE_DIR/server
pm2 stop jasmine 2>/dev/null || true
pm2 delete jasmine 2>/dev/null || true
pm2 start ecosystem.config.cjs --name jasmine

# 童心后端
cd $CHILDHEART_DIR/server
pm2 stop childheart 2>/dev/null || true
pm2 delete childheart 2>/dev/null || true
pm2 start ecosystem.config.cjs --name childheart

pm2 save
echo "✅ PM2 服务启动完成"

# ── Nginx 配置 ──────────────────────────────────────────
echo "[7/8] 配置 Nginx..."
sudo cp $JASMINE_DIR/server/deploy/nginx.conf /etc/nginx/sites-available/jasmine.conf
sudo cp $CHILDHEART_DIR/server/deploy/nginx.conf /etc/nginx/sites-available/childheart.conf
sudo ln -sf /etc/nginx/sites-available/jasmine.conf /etc/nginx/sites-enabled/jasmine.conf
sudo ln -sf /etc/nginx/sites-available/childheart.conf /etc/nginx/sites-enabled/childheart.conf
sudo nginx -t && sudo nginx -s reload
echo "✅ Nginx 配置完成"

# ── 完成 ────────────────────────────────────────────────
echo ""
echo "=========================================="
echo "✅ 全部部署完成！"
echo "=========================================="
echo ""
echo "访问地址（IP直连）："
echo "  茉莉心理：http://<服务器IP>/"
echo "  童心惠民：http://<服务器IP>:8080/"
echo ""
echo "服务状态："
pm2 status
echo ""
echo "管理命令："
echo "  pm2 logs jasmine       # 茉莉后端日志"
echo "  pm2 logs childheart    # 童心后端日志"
echo "  pm2 restart all        # 重启所有服务"
