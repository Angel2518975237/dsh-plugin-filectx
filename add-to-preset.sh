#!/usr/bin/env bash
# 把插件行加入一个 agent preset。
# 用法： ./add-to-preset.sh [源preset id，默认 standard]
# 行为：
#   1) 复制源 preset 到 ~/.dsh/.agent-presets/<源>-filectx/
#   2) 在副本的 agent.cordis.yml 末尾追加插件行
#   3) 写好 preset.yml（名称：标准模式·文件右键）
set -euo pipefail

FROM="${1:-standard}"
ROOT="$HOME/.dsh/.agent-presets"
ID="$FROM-filectx"
SRC="$ROOT/$FROM"
DEST="$ROOT/$ID"

if [ ! -d "$SRC" ]; then
  echo "错误：源 preset 不存在：$SRC" >&2
  echo "提示：仓库发布版 DSH 在部署 config 旁的 agent-presets 目录里带 standard/code/minimal/cordis。" >&2
  exit 1
fi
if [ ! -f "$HOME/node_modules/dsh-plugin-filectx/lib/index.js" ]; then
  echo "错误：插件包未安装，请先运行 ./install.sh" >&2
  exit 1
fi

rm -rf "$DEST"
cp -R "$SRC" "$DEST"

if ! grep -q "dsh-plugin-filectx" "$DEST/agent.cordis.yml"; then
  cat >> "$DEST/agent.cordis.yml" <<'ROW'

# ── file context menu ───────────────────────────────────────────────────────
# Dual-face package `dsh-plugin-filectx` (installed at ~/node_modules/ by its
# install.sh). Node half serves /filectx-api through the host webServer and
# runs native open/open-with/reveal/clipboard commands via the host
# `subprocess` service with literal argv arrays; web half (dsh.client) ships
# the right-click menu for produced-file chips and inline file mentions.
# Publishes no service, so it needs no realm; the webServer route is
# refcounted across concurrent sessions.
- id: file-context-menu
  name: 'dsh-plugin-filectx'
ROW
fi

cat > "$DEST/preset.yml" <<'META'
name: 标准模式·文件右键
description: 在源 preset 基础上，为聊天产物文件与文件引用提供右键菜单（打开、浏览器打开、选择浏览器、访达中显示、复制路径）。
META

echo "✅ 已创建 preset：$ID"
echo "   路径：$DEST"
echo
echo "使用：新建会话时选择「标准模式·文件右键」preset；页面若已打开请刷新一次。"
echo "校验（可选）：让一个挂在该 preset 的会话执行 agent_presets_admin 工具的 check 操作。"
