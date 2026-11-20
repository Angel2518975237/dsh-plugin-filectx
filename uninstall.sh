#!/usr/bin/env bash
# dsh-plugin-filectx 卸载脚本：移除已安装的插件包。
set -euo pipefail
DEST="$HOME/node_modules/dsh-plugin-filectx"
if [ -d "$DEST" ]; then
  rm -rf "$DEST"
  echo "✅ 已移除 $DEST"
else
  echo "未发现已安装的插件包（$DEST）"
fi
echo "记得从 preset 的 agent.cordis.yml 中删除 file-context-menu 行。"
