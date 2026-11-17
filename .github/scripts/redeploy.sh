#!/usr/bin/env bash
# 把現有的 Apps Script 網頁應用程式部署更新到新版本（網址不變），然後打 API 確認還能正常回 JSON；
# 不正常就自動改回原本的版本。
#
# 用法（在有 .clasp.json 的資料夾執行）：redeploy.sh <部署 ID> <冒煙測試用的 action>
#
# 注意：這裡只「更新」編輯器 UI 建立的那個既有部署（clasp deploy -i），不建立新部署——
# 用 API「新建」的網頁應用程式部署有授權問題（見 CLAUDE.md），更新既有部署則沿用它原本的設定。
set -euo pipefail

DEPLOYMENT_ID="$1"
SMOKE_ACTION="$2"
URL="https://script.google.com/macros/s/${DEPLOYMENT_ID}/exec"
COMMIT_TITLE="${COMMIT_TITLE:-}"
GITHUB_SHA="${GITHUB_SHA:-manual}"
DESC="auto: ${GITHUB_SHA:0:7} ${COMMIT_TITLE%%$'\n'*}"
DESC="${DESC:0:100}"

deployments_json="$(clasp --json deployments)"
prev_version="$(node -e '
  const list = JSON.parse(process.argv[1]);
  const d = list.find(x => x.deploymentId === process.argv[2]);
  if (!d) { console.log("MISSING"); } else { console.log(d.versionNumber || "HEAD"); }
' "$deployments_json" "$DEPLOYMENT_ID")"

if [ "$prev_version" = "MISSING" ]; then
  echo "::warning::這個專案找不到部署 ${DEPLOYMENT_ID}，略過自動發布（程式碼已 push，請手動發布）"
  exit 0
fi
echo "目前部署版本：@${prev_version}"

new_json="$(clasp --json deploy -i "$DEPLOYMENT_ID" -d "$DESC")"
echo "$new_json"
new_version="$(node -e 'console.log(JSON.parse(process.argv[1]).versionNumber || "")' "$new_json")"
echo "已更新到版本：@${new_version}"

smoke() {
  local body
  for attempt in 1 2 3 4; do
    sleep 10
    body="$(curl -sSL -m 60 "${URL}?action=${SMOKE_ACTION}&_t=$(date +%s)" || true)"
    if node -e '
      let d; try { d = JSON.parse(process.argv[1]); } catch (e) { process.exit(1); }
      process.exit(d && !d.error ? 0 : 1);
    ' "$body"; then
      echo "冒煙測試通過（第 ${attempt} 次）：${body:0:200}"
      return 0
    fi
    echo "冒煙測試第 ${attempt} 次失敗：${body:0:300}"
  done
  return 1
}

if smoke; then
  exit 0
fi

if [ "$prev_version" != "HEAD" ]; then
  echo "::error::新版本 @${new_version} 打不通，改回原本的版本 @${prev_version}"
  clasp deploy -i "$DEPLOYMENT_ID" -V "$prev_version" -d "rollback from @${new_version}"
else
  echo "::error::新版本 @${new_version} 打不通，原本是 @HEAD 無法自動改回，請手動處理"
fi
exit 1
