# prayer-card

Google Sheets + Apps Script 禱告卡片工具。`.clasp.json`、`.github/workflows/deploy.yml` 讓 merge 進 `main` 後自動 `clasp push` 到 Apps Script（不含 deploy，發布新版本仍需手動，因為 API 建立的 web app 部署對 `executeAs: USER_DEPLOYING` 有已知的授權限制）。

## 正確的 Apps Script scriptId

```
1xh1RZ3UG79qlw7-uYbB_ahH52ilKz9CF-UEw-j7hr-rjtz3TeDK4NJFu
```

**注意**：這個帳號下還有另一個同名（也叫「禱告卡」，或顯示為「google task亂數排序」，標題會變）但完全無關的專案，scriptId 是 `1FsqwjFIXabMnRieznVINMBAX1RJJC4nz-2C0aZnnqQhHUwxA95KkqxHz`——**這個是錯的，2026-07-25 曾經被誤用，導致這個無關專案的程式碼被覆蓋**（詳見 `Davycmg/apps-script-projects` repo 的事故記錄，已在該 repo 修復還原）。

如果之後要重新確認 scriptId 是否正確，**不要**只憑網址、截圖或專案標題判斷（Apps Script 編輯器是 SPA，切換專案時畫面可能顯示混合的舊資料）。唯一保證正確的方法：從實際的 Google 試算表（有「表單回覆 1」、「禱告卡片」分頁那份，標題「PUSH (回覆)」）用「擴充功能 → Apps Script」打開，並先做一次完整的網頁重新整理，再看網址列的 scriptId。

## 靜態頁面（home.html／calendar.html／today.html／index.html／query.html／add-item.html）的兩種服務方式

這幾個根目錄的 `.html` 檔案雖然都會被 `clasp push` 推到同一個 Apps Script 專案裡，但實際被瀏覽的方式分兩種，不要搞混：

1. **Apps Script `doGet` 路由**（`禱告卡部署.gs`）：目前只有 `index.html`（預設，不帶 `page` 參數）、`query.html`（`?page=query`）、`add-item.html`（`?page=add-item`）是透過 Apps Script 部署網址（`.../exec?...`）直接服務的。
2. **GitHub Pages 靜態網站**：`home.html`、`calendar.html`、`today.html` 這幾個是透過 GitHub Pages 開啟的，網址是 `https://davycmg.github.io/prayer-card/<檔名>.html`（例如 `.../calendar.html`、`.../today.html`）。GitHub Pages 直接從 repo 的 `main` 分支同步靜態檔案，**只要 merge 進 main 就會自動更新**，不需要額外部署步驟（跟 Apps Script 那邊「還要手動發布新版本」不一樣）。這些頁面本身不含資料，開啟後單純用 JS `fetch` 打 Apps Script 部署網址（`API_URL` 常數）當後端 API 抓資料、寫資料。

新增這類「純前端＋打 API」的新頁面時，兩件事都要做：檔案本身推到 Apps Script 專案（`clasp push`，走 workflow 自動做）、以及讓它同時存在於 `main` 分支給 GitHub Pages 抓（同一份檔案，不用另外處理，只是要記得 merge 進 main 才會生效）。

## today.html（Google Tasks 預設清單版的「每日待辦」代禱卡片）

跟 `calendar.html`（抓 Google 日曆今天的行程）並列的另一個「即時抓資料」頁面，抓的是 Google Tasks 預設清單裡「還沒完成」的項目。

- 網址：`https://davycmg.github.io/prayer-card/today.html`
- 沒有排程／定時任務，「每天自動更新」是靠**每次載入頁面都即時查詢**達成的（跟 `calendar.html` 的 `getTodayCalendarEvents` 機制一致）：後端 `getTodayTasksList()`（`禱告卡部署.gs`）每次被呼叫都直接呼叫 Google Tasks API 抓當下未完成的項目，不會把資料存到試算表或其他地方快取。
- 相關 action（`禱告卡部署.gs` 的 `doGet`）：`getTodayTasksList`（列出未完成項目）、`updateTaskTitle`（編輯標題會同步回 Google Tasks）、`completeTaskItem`（標記完成＝從清單移除，Google Tasks 裡仍保留完成紀錄，不是真的刪除）。
- 前端沿用 `calendar.html` 的翻頁／隨機／朗讀邏輯，但拿掉「週期」欄位（Tasks 沒有週期概念），刪除鈕改成「標記完成」。

## dg-network（另一個獨立的代禱表單／卡片專案）

`dg-network/` 是同一套代禱表單＋代禱卡片工具的**另一份獨立部署**，給「DG網絡」這個群組用，跟根目錄的 prayer-card 是各自獨立的 Google 試算表 + Apps Script 專案（各自的 scriptId、各自的資料），**不要混用**。

- scriptId（`dg-network/.clasp.json`）：`1deOb0Nu0u8gEPDjaEwaWC3FxKmW3z62yewT3x7R2hkJxFX4tHz5cr4mu`
- 檔案：`Code.js`（主程式）、`Form.html`（代禱表單）、`FormNoCycle.html`（代禱表單，不顯示 DG 週期欄位的簡化版）、`CardIndex.html`（代禱卡片網頁版）、`appsscript.json`
- 資料來源分頁：`表單回覆 1`（Google 表單回覆），卡片操作用分頁：`代禱卡片`
- 部署網址：`https://script.google.com/macros/s/AKfycbxVIblgOu-oH0viw2Poowfda4a_feDaySi0bU5IQzVC_IDbKIm0oOEDhoVaqfmQuBfe/exec`
- 網址用法（同一個部署網址，用參數區分）：
  - `.../exec` → 代禱表單（依姓名帶出舊資料編輯）
  - `.../exec?form=simple` → 代禱表單簡化版（不顯示 DG 週期，有舊資料就沿用原週期，沒有就預設「每月」）
  - `.../exec?view=card` → 代禱卡片網頁（今日待代禱名單，可翻頁、朗讀）
  - `.../exec?action=xxx` → 代禱卡片專用資料 API（前端 fetch 用）
- 也內建 Google Sheet 內操作版的代禱卡片（`onOpen` 選單「🙏 代禱卡片」），含自動合併同名重複資料、朗讀連禱等功能。

## 一次性匯入腳本（不在這個 repo 版本控制內）

`importReminders()`（匯入「提醒事項」PDF 內容到「表單回覆 1」，327 筆資料以 Base64 內嵌）這類一次性用途的 Apps Script 程式碼，**不會**存在這個 GitHub repo 裡（`git grep` 全歷史都找不到），因為是直接在 Apps Script 編輯器貼上執行一次、沒有透過 `clasp push` 推回 repo。

`importReminders()` 這份 code 的原始出處：https://claude.ai/chat/82f4e06a-80c2-409e-8f49-563f0fddb7db
