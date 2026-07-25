# prayer-card

Google Sheets + Apps Script 禱告卡片工具。`.clasp.json`、`.github/workflows/deploy.yml` 讓 merge 進 `main` 後自動 `clasp push` 到 Apps Script（不含 deploy，發布新版本仍需手動，因為 API 建立的 web app 部署對 `executeAs: USER_DEPLOYING` 有已知的授權限制）。

## 正確的 Apps Script scriptId

```
1xh1RZ3UG79qlw7-uYbB_ahH52ilKz9CF-UEw-j7hr-rjtz3TeDK4NJFu
```

**注意**：這個帳號下還有另一個同名（也叫「禱告卡」，或顯示為「google task亂數排序」，標題會變）但完全無關的專案，scriptId 是 `1FsqwjFIXabMnRieznVINMBAX1RJJC4nz-2C0aZnnqQhHUwxA95KkqxHz`——**這個是錯的，2026-07-25 曾經被誤用，導致這個無關專案的程式碼被覆蓋**（詳見 `Davycmg/apps-script-projects` repo 的事故記錄，已在該 repo 修復還原）。

如果之後要重新確認 scriptId 是否正確，**不要**只憑網址、截圖或專案標題判斷（Apps Script 編輯器是 SPA，切換專案時畫面可能顯示混合的舊資料）。唯一保證正確的方法：從實際的 Google 試算表（有「表單回覆 1」、「禱告卡片」分頁那份，標題「PUSH (回覆)」）用「擴充功能 → Apps Script」打開，並先做一次完整的網頁重新整理，再看網址列的 scriptId。
