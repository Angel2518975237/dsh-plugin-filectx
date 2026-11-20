#!/usr/bin/env bash
# dsh-plugin-filectx 安装脚本
# 把插件包复制到 ~/node_modules/ —— DSH 的宿主加载器（preset 组合行的包解析）
# 与 web 客户端模块扫描（dsh.client 双面包发现）都能从这里解析。
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/node_modules/dsh-plugin-filectx"

if [ ! -f "$SRC/lib/index.js" ] || [ ! -f "$SRC/lib/client.js" ]; then
  echo "错误：请在仓库根目录运行本脚本（找不到 lib/index.js 或 lib/client.js）" >&2
  exit 1
fi

mkdir -p "$HOME/node_modules"
rm -rf "$DEST"
mkdir -p "$DEST/lib"
cp "$SRC/package.json" "$DEST/package.json"
cp "$SRC/lib/index.js" "$DEST/lib/index.js"
cp "$SRC/lib/client.js" "$DEST/lib/client.js"

echo "✅ 插件包已安装到 $DEST"
echo
echo "下一步：把插件行加入你的 agent preset。"
echo "  快捷方式：  ./add-to-preset.sh standard"
echo "  （会复制 standard preset 为 standard-filectx 并追加插件行）"
echo "  手动方式：  编辑 ~/.dsh/.agent-presets/<你的preset>/agent.cordis.yml，追加："
echo
echo "  - id: file-context-menu"
echo "    name: 'dsh-plugin-filectx'"
echo
echo "然后在含该行的 preset 上开启会话；若页面已打开，刷新一次。"
