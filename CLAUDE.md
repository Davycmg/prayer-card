# prayer-card

Google Sheets + Apps Script 禱告卡片工具。`.clasp.json`、`.github/workflows/deploy.yml` 讓 merge 進 `main` 後自動 `clasp push` 到 Apps Script（不含 deploy，發布新版本仍需手動，因為 API 建立的 web app 部署對 `executeAs: USER_DEPLOYING` 有已知的授權限制）。

## 正確的 Apps Script scriptId

```
1xh1RZ3UG79qlw7-uYbB_ahH52ilKz9CF-UEw-j7hr-rjtz3TeDK4NJFu
```

**注意**：這個帳號下還有另一個同名（也叫「禱告卡」，或顯示為「google task亂數排序」，標題會變）但完全無關的專案，scriptId 是 `1FsqwjFIXabMnRieznVINMBAX1RJJC4nz-2C0aZnnqQhHUwxA95KkqxHz`——**這個是錯的，2026-07-25 曾經被誤用，導致這個無關專案的程式碼被覆蓋**（詳見 `Davycmg/apps-script-projects` repo 的事故記錄，已在該 repo 修復還原）。

如果之後要重新確認 scriptId 是否正確，**不要**只憑網址、截圖或專案標題判斷（Apps Script 編輯器是 SPA，切換專案時畫面可能顯示混合的舊資料）。唯一保證正確的方法：從實際的 Google 試算表（有「表單回覆 1」、「禱告卡片」分頁那份，標題「PUSH (回覆)」）用「擴充功能 → Apps Script」打開，並先做一次完整的網頁重新整理，再看網址列的 scriptId。

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
