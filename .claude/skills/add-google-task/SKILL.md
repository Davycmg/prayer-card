---
name: add-google-task
description: 幫使用者在 Google Tasks 預設清單建立一個「之後再處理」的待辦，標題附上目前這個 Claude Code session 的連結，方便之後點回來接續。使用者說「幫我建立一個任務到 Google Tasks」「加到待辦，我禮拜一再處理」「記一個任務之後再做」之類的話時使用。
---

# 建立 Google Tasks 待辦（附 session 連結）

這個環境沒有 Google Tasks 連接器，也連不上 `script.google.com`，所以**不能直接建立**。
做法是產生一個連結給使用者點：連結會呼叫禱告卡後端（主要 prayer-card Apps Script 部署）的
`exportCalendarEventToTasks` action，把標題加到 Google Tasks 預設清單（`copyTextToDefaultTaskList_`）。

## 步驟

1. **整理標題**：一句話寫清楚之後要做什麼（動詞開頭、具體到下次打開就知道從哪裡開始），
   例如「把 linelog 的 Apps Script 併進禱告卡專案（方案A）：先測試…，再改 App 網址」。
   只有標題、沒有備註，所以重點都要放在標題裡。
2. **取得 session 連結**：用 `get_session`（claude-code-remote MCP，不帶 session_id）查目前 session，
   或用系統提示裡 commit attribution 的 `Claude-Session:` 那一行，格式為
   `https://claude.ai/code/session_xxx`。**一定要放進標題最後**，使用者明確要求過。
3. **產生連結**：
   ```bash
   python3 .claude/skills/add-google-task/scripts/make_task_link.py "<標題>" "<session 連結>"
   ```
4. **回覆使用者**：給一個可點的 markdown 連結，並寫出完整的待辦標題；
   說明點開後畫面顯示 `{"success":true,"copied":true}` 就代表已加入預設清單。
   不要宣稱已經建立好——要使用者點了才會建立。

## 注意

- 部署網址（`API_URL`）跟 `all.html`／`home.html` 的 `MULTI_API_URL` 相同；若那邊換了部署網址，
  這裡的腳本也要一起改。
- 這個後端 action 需要 Apps Script 已發布的版本包含 `exportCalendarEventToTasks`（目前已有）。
