# prayer-card

## PR 自動 merge 規則

在這個 repo 開的 PR，預設**不用每次先問過使用者，開完就直接 merge**。例外：CI 沒過（紅字）或 PR 有 merge conflict 時，維持原本規則，先跟使用者確認再處理，不要自動 merge。

Google Sheets + Apps Script 禱告卡片工具。`.clasp.json`、`.github/workflows/deploy.yml` 讓 merge 進 `main` 後自動 `clasp push` 到 Apps Script。

## 自動發布新版本（2026-11-17 起）

`deploy.yml` 在 push 之後，主要 prayer-card 專案與 dg-network 各自跑 `.github/scripts/redeploy.sh`：用 `clasp deploy -i <部署ID>` 把**編輯器 UI 建立的既有部署**更新到新版本（網址不變；不用 API 新建部署，因為 API 新建的 web app 部署對 `executeAs: USER_DEPLOYING` 有已知的授權限制）。更新後打 `?action=getPrayerProgress` 冒煙測試（最多 4 次、每次隔 10 秒），回的不是正常 JSON 就自動改回原本的版本、workflow 標紅。部署 ID 寫在 `deploy.yml` 的 `MAIN_DEPLOYMENT_ID`／`DG_NETWORK_DEPLOYMENT_ID`；找不到該部署就只 push、跳警告。這次 merge 沒改到該專案的 `.gs/.js/.html/appsscript.json` 就不發布（每次發布用掉一個版本號，每個專案上限 200 個版本，快滿時要到編輯器刪舊版本）；手動執行 workflow（workflow_dispatch）兩個專案一律發布。舊的 `linelog/` 專案不自動發布。

所以下面各段寫的「要手動發布新版本才生效」，現在 merge 後等 workflow 跑完（約 1～2 分鐘）就生效；workflow 紅字時再看 Actions 的 log。例外：新增了需要新授權範圍的功能（例如第一次用 `UrlFetchApp`），還是要先在編輯器手動執行一次授權，否則冒煙測試可能過、但新功能執行時報授權錯誤。

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

## nonwork.html（為非工作事務禱告）

`today.html` 的姊妹頁：同樣抓 Google Tasks 預設清單未完成項目，但只留標題以 `H` 開頭的任務（後端 action `getPrefixTasksList`，`prefix` 預設 `H`；比對不分大小寫、全形半形視為相同、標題開頭空白忽略）。網址：`https://davycmg.github.io/prayer-card/nonwork.html`。跟 today.html 一樣進頁面預設隨機打亂、記憶已看過（localStorage key `nonworkHtml_drawnKeys`）。

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
  - `.../exec?view=all` → 為網絡禱告（`AllCard.html`，2026-11-12）：根目錄 all.html 的版面，但只有「網絡」這個來源，拿掉所有 Google Tasks／日曆／多方禱告相關的按鈕（篩選列、AI整理、標籤、複製到 Tasks、加入日曆、垃圾桶、LINE 等）。保留：翻頁／隨機／跳到、完成（含防誤觸）、刪除、改週期、改備註、朗讀（姓名＋備註）、一鍵輸出、操作歷程（重送／復原）。API 打同一個部署網址（`tmpl.apiUrl`）。要手動發布新版本才生效。
    - **朗讀用 Gemini TTS「Zephyr」語音（2026-11-17，`dg-network/Zephyr朗讀.js`）**：瀏覽器內建語音沒有 Zephyr，所以前端 POST（`text/plain`，`{action:'tts',text}`）到 dg-network 的 `doPost` → 後端呼叫 Gemini API（預設模型 `gemini-2.5-flash-preview-tts`，可用指令碼屬性 `GEMINI_TTS_MODEL` 覆寫）回傳 24kHz PCM base64，前端包成 WAV 播放。同一段文字只抓一次（7 遍共用），遍數「1、2…」另外抓並快取，唸目前這項時預抓下一項。API key 存指令碼屬性 `GEMINI_API_KEY`（不進 repo）；部署公開所以每段最多 2000 字、每天 1000 次（`ZEPHYR_TTS_USAGE`）。取不到 Zephyr 時該遍改用瀏覽器語音，連續失敗 3 次就整個頁面改用瀏覽器語音。第一次要在編輯器手動執行 `checkZephyrTts()` 授權外部連線，再發布新版本。短文字（例如遍數「1」）Gemini 會當提問回 400「Model tried to generate text」，所以送出前加英文朗讀指示＋遇錯重試 3 次（2026-11-17）。`doPost` 的 `tts` 也接受 `voice`（`GEMINI_TTS_VOICES` 30 個預設語音之一）和 `model`（`GEMINI_TTS_MODELS` 白名單），給試聽其他聲音用；頁面目前固定 Zephyr。
    - **分眾（2026-11-17，`dg-network/分眾負責.js`）**：試算表新分頁「分眾負責」（第一次用自動建立），一列＝代禱對象（姓名，對「表單回覆 1」B 欄）× 負責人，C／D 欄是這位負責人自己的本次／下次代禱。一位代禱對象可有多位負責人，**各自完成、各自算日期**（`completeForAssignee`，不動主表 F／G）；週期、備註仍以主表為準。頁面上方「我是 [負責人▼]」＋三個模式：「👤 我的」（`getGroupItems&who=`，依自己的 D 欄）、「❓ 未分配」（沒有負責人的，依主表 F／G）、「🌐 全部」（管理者總覽，依主表 F／G）；後兩者的完成照舊打 `completeByRow`。卡片上「負責人」列：✕ 移除（按兩下確認）、🙋 我來負責、➕ 指派（`assignPerson`／`unassignPerson`）。完成／指派／移除都進操作歷程、可復原（`undoCompleteForAssignee`／`reassignPerson` 會把原本日期放回）。`?view=all&who=名字` 直接開某人的「我的」；選的人與模式存 localStorage（`dgAllCard_who`／`dgAllCard_mode`）。用姓名對應不用列號，主表刪列不影響；主表已刪掉的人在「我的」裡自動略過。要手動發布新版本。
  - `.../exec?action=xxx` → 代禱卡片專用資料 API（前端 fetch 用）
- 也內建 Google Sheet 內操作版的代禱卡片（`onOpen` 選單「🙏 代禱卡片」），含自動合併同名重複資料、朗讀連禱等功能。

## 一次性匯入腳本（不在這個 repo 版本控制內）

`importReminders()`（匯入「提醒事項」PDF 內容到「表單回覆 1」，327 筆資料以 Base64 內嵌）這類一次性用途的 Apps Script 程式碼，**不會**存在這個 GitHub repo 裡（`git grep` 全歷史都找不到），因為是直接在 Apps Script 編輯器貼上執行一次、沒有透過 `clasp push` 推回 repo。

`importReminders()` 這份 code 的原始出處：https://claude.ai/chat/82f4e06a-80c2-409e-8f49-563f0fddb7db

2026-08-07 有一份更新版 `importReminders260807()`（同樣寫入同一份試算表／「表單回覆 1」，65 筆資料，標籤規則改成排除 `#安祺禱告` 與週期標籤）。跟舊版不同，這份**有**存進這個 repo（`importReminders260807.gs`），會隨 `clasp push` 一起推到主要 prayer-card 專案。注意：推上去只是把函式定義推過去，**不會自動執行**——匯入試算表仍要到 Apps Script 編輯器手動執行一次 `importReminders260807()`，執行完建議把這個檔案刪掉（避免不小心重複執行造成重複匯入）。主要 prayer-card 專案：https://script.google.com/home/projects/1xh1RZ3UG79qlw7-uYbB_ahH52ilKz9CF-UEw-j7hr-rjtz3TeDK4NJFu/edit

## LINE通知記錄（linelog）接收端：`LINE通知記錄.gs`

`Davycmg/APK` 的 linelog App（監聽 LINE 通知 → 寫進 Google Tasks 預設清單）的 Apps Script 接收端，2026-10 從獨立專案併進這個專案（`doPost`）。原因：其他 Apps Script 專案建立的 Google Tasks 任務，這個專案的完成／改標題／移到工作日會收到「The caller does not have permission」，同一個專案建立的才改得動。

- 這個專案的部署網址公開寫在 GitHub Pages 頁面裡，所以 `doPost` 必須帶 `?key=金鑰`；金鑰存在指令碼屬性 `LINELOG_KEY`（不進 repo）。第一次在編輯器執行 `setupLinelogKey()`，執行記錄會印出要貼進 App 的網址。
- App 的網址要改成 `<禱告卡部署網址>/exec?key=<金鑰>`；舊的獨立 linelog 專案先留著，有問題可以把 App 網址改回去。
- 舊專案建立、這個專案改不動的任務：收到同一個人的新訊息時會改開新任務（舊的留著，需手動完成）。
- **黑名單（`B` 前綴，2026-10-28）**：把任務標題改成 `B名字：…`（最簡單是把 LINE 任務的 `1 ` 改成 `B`），下一次 `doPost` 收到通知時會把 `B` 到第一個冒號之間的名字（不分大小寫、全形半形相同、群組可寫 `[群組]` 或不加括號）加進指令碼屬性 `LINELOG_BLACKLIST`（JSON 陣列），B 任務與該對象現有的未完成 LINE 任務都標記完成；之後好友名／群組名／群組內寄件者在黑名單上的訊息直接丟掉不建任務。處理時機是「下一則 LINE 通知進來時」（沿用 doPost 本來就會抓的未完成清單，不多打 API），不是排程。B 任務自己馬上勾完成也有效：每次 `doPost` 會另外抓「上次檢查後才更新、已完成」的任務（`updatedMin`，時間點存在指令碼屬性 `LINELOG_RULES_SINCE`）。解除黑名單：任務標題打 `UB名字：`（同樣可直接勾完成），規則依任務更新時間先後套用。也可以在 `all.html`「🚫 LINE 黑名單（查詢／解除）」面板查詢名單、按「解除」立即移出（action `getLinelogBlacklist`／`removeLinelogBlacklist`，後者跟 doPost 共用 ScriptLock），或直接編輯指令碼屬性 `LINELOG_BLACKLIST`。名單裡存的是正規化後的名字（小寫、全形轉半形）。注意：任何 `B` 開頭且含冒號的任務都會被當成黑名單規則。

### 舊的獨立 linelog 專案（`linelog/`）與「合併 LINE 通知待辦」按鈕

舊的獨立專案（scriptId `1c_A0sMVRFrtbGa3hFvHUTNnB_sD-NxehM8tRa5mm6hK_Sk0cMXreGohT`，部署 `AKfycbxwHrhj…`）2026-10-25 用一次性 workflow `clasp pull` 抓進 `linelog/`（`deploy.yml` 的 `push-linelog` job 自動 push，`.claspignore` 排除避免主專案多一個 `doPost`）。它在併進禱告卡之後還被改過（一個群組一個任務、CacheService 記任務 ID、`mergeExisting()`），所以同天把這些邏輯搬進 `LINE通知記錄.gs`（函式加 `linelog` 前綴）。

- LINE App 目前的網址是禱告卡的（帶 `?key=`，2026-10-25 使用者截圖確認），新任務都由禱告卡建立。
- `all.html`「🔗 合併 LINE 通知待辦」按鈕打禱告卡的 `?action=mergeLinelogTasks` → `linelogMergeExisting()`。舊專案建立的任務禱告卡改不動：保留的任務選「由新到舊第一個改得動的」，刪不掉的留著並回報數量，請使用者手動完成。不要再把按鈕改回打舊專案（它改不動禱告卡建立的任務，2026-10-25 實際踩過）。

## home.html「今天的 Highlight」

取代原本首頁的「今日待辦禱告」卡片（today.html 連結移到下方按鈕列）。「設定」（在頁面下方按鈕列）可輸入最多 7 個 Highlight（第 1 個固定是 Google Task，可取消勾選）和每次計時分鐘數，存在後端 PropertiesService（action `getHighlightSettings`／`saveHighlightSettings`，各裝置同步；頁面載入時抓最新的，localStorage `homeHtml_highlightSettings` 只當快取）。卡片上兩個按鈕：「指定」自己選一個、「Highlight 抽籤」隨機抽一個（抽到 Google Task 會再從預設清單未完成待辦隨機抽一個），開始倒數計時；時間到後只有「有進度」一個按鈕（2026-11-17 拿掉「沒做到」），「提前結束」也直接視為有進度；兩者按下後都會自動再抽下一個 Highlight 開始計時，**按下有進度／提前結束按鈕時才**記錄到「隨機抽待辦任務」同一個日曆（`DRAW_TASK_CALENDAR_ID`），結束時間＝按下按鈕的時間。記錄放背景做（不用等就能再抽）：先存進 localStorage `homeHtml_highlightPendingLogs`，再依序呼叫 `startHighlightSession`（建事件）＋`finishHighlightSession`（回填結束時間和結果），失敗的下次打開首頁自動重送（已建好的事件 ID 會存著，不會重複建）。計時中狀態存在 `homeHtml_highlightSession`，重新整理頁面可接續。

## 日曆記錄的長度上限（隨機抽待辦任務／Highlight）

「隨機抽待辦任務」是用下一次點擊的時間回填上一筆的結束時間，所以隔夜才再抽會產生跨夜的行程。`DRAW_TASK_MAX_DURATION_MINUTES`（`禱告卡部署.gs`，預設 60 分鐘）限制一筆最長只記到「開始 + 60 分鐘」；Highlight 則最多記到「預計結束 + 60 分鐘」。

## all.html「📜 操作歷程」

每個寫入動作（完成／刪除／改文字／改週期／標籤…）在 `apiCallWithRetry` 統一記進 localStorage `allHtml_opLog`（最多 500 筆，只記這台裝置）：排隊中→已送出→成功／失敗。起因（2026-10-29）：列號類動作是排隊一個一個送、每個要等 Apps Script 幾秒，連續處理幾十項後馬上重新整理，排隊中的請求根本沒送出，數字就不會減少。現在：還有沒送完的會在按鈕上顯示筆數、`beforeunload` 攔住關頁面；下次載入時「排隊中」的標成「沒送出」、「已送出」的標成「沒等到回應」並跳紅字提醒。「沒送出／失敗」且帶 `expect`／`taskId`／`eventId` 的可以按「重送」（網絡禱告只有列號，重送可能對錯列，所以不提供）。

2026-10-29 晚上使用者回報：歷程顯示「完成 成功」，重新整理後項目又出現。查試算表確認那些列的 E 欄日期確實沒被推進，但 `getPrayerProgress` 顯示今天伺服器有記到 43 次完成、部署版本也是最新程式碼，**原因（2026-10-30 確認）：「表單回覆 1」是 Google 試算表的「表格」，使用者在標籤欄套了篩選（藏了 1411 列），Apps Script 寫入被篩選藏起來的列會被默默丟掉、不報錯；拿掉篩選就恢復正常。** 要看特定標籤請用「篩選器檢視畫面」。當時加的兩道檢查：前端每次載入後，把今天回報成功的「完成」跟到期清單比對，還在的標成「⚠️ 回報成功但沒生效」；後端 `completeByRow` 寫完 `flush()` 後讀回 E 欄，日期不在今天之後就丟錯（不再回成功），並 `console.log` 列號與舊→新日期，回傳 `row`／`newDate` 讓歷程顯示「下次 yyyy/MM/dd（第 N 列）」。之後再遇到，看 Apps Script「執行項目」的 log 對照。

## all.html「📅 校正週清單」按鈕（`週清單校正.gs`）

補救 `Davycmg/apps-script-projects` 的 `google-task-weekday-scheduler`（另一個專案，每晚 23:50 把 `E週X` 任務收進「週X」清單、每天 03:50 把今天的週清單搬回預設清單）漏搬的任務。起因 2026-10-29 23:44 那一輪 9 個 `E週四` 任務 Quota Exceeded 被跳過，週五還留在預設清單。按鈕打 action `fixWeekdayTaskLists`：預設清單／「工作區」裡非今天的 `E週X` → 搬回「週X」；今天的「週X」清單還有任務 → 搬回預設清單。前綴比對跟 weekday-scheduler 一致（直接 `startsWith('E週X')`）。重跑安全；後端每批 4.5 分鐘，回 `more` 時前端自動接著跑。別的專案建立、這個專案沒權限搬的任務會列在「失敗」裡。

2026-11-03 手機上一堆「排隊中」永遠不送：`pagehide` 設了 `pageUnloading = true` 就沒改回來，頁面從 bfcache 還原（切去別頁再按返回）後，排隊的請求一跑到就被擋、錯誤又因為 `pageUnloading` 不記，全部停在「排隊中」。現在 `pageshow`（`persisted`）時改回 false，暫停期間擋下的請求接著送（`afterPageRestore`）。

### 操作歷程的「復原」（2026-10-30）

歷程裡成功的動作旁有「復原」鈕（按兩下確認）。後端回傳復原需要的資料、存進歷程的 `result`：`completeByRow` 回 `oldDate`（原本空白回空字串）→ 復原打 `undoCompleteByRow`（把 E 欄改回、今日完成數減一）；`deleteByRow` 回 `trashRow` → `undoDeleteByRow`（先用文字確認垃圾桶列號，對不上從下往上找同文字，救回附加到最後一列）；`updateFieldByRow`（改文字／週期／標籤）回 `oldValue` → 再打同一個 update 改回去（改文字時 `expect` 用新文字）；`completeTaskItem` 回 `listId` → `uncompleteTaskItem`（改回 needsAction）。不能復原：習慣（日曆）、改待辦標題、改版前的舊記錄。後端部分要手動發布新版本才生效。

網絡禱告（2026-10-31，`dg-network/Code.js`）：all.html 打 dg-network 的列號動作現在都帶 `expect`（姓名），`handleCardApi_` 用 `resolveRowByName_` 確認／找回列號。`completeByRow_` 回 `oldThis`／`oldNext`（F／G 欄完成前的值，`serializeCell_` 序列化，日期存成 `{"d":ISO}`）→ 復原打 `undoCompleteByRow`；dg-network 沒有垃圾桶，`deleteByRow_` 回整列 `rowValues` → 復原打 `restoreRow`（加回最後一列）；`updateFieldByRow_`（週期／備註）回 `oldValue`。dg-network 也要另外手動發布新版本（部署網址 `AKfycbxVIblg…`）。

## query.html「引號標籤」（2026-10-30）

事項文字（B欄）裡用雙引號（半形 `"`、全形 `“ ”`、`＂`、`〝 〞`、`‟ „` 都算，前後不必成對，`“詞“`、`”詞”` 也可以，2026-11-22）包起來、1～15 字的詞（例如 `"祈願牆"`），會出現在 query.html「依標籤查詢」選單裡（顯示成 `"祈願牆"（文字）`）。選了之後 `getItemsByTag` 會找出 H 欄標籤相同、**或事項文字含這個詞**的所有項目——其他沒加引號、但文字裡有這個詞的也會一起被找到。前端用 `getTagList&withQuoted=true` 取得引號詞清單（`getQuotedWords_()`），其他頁面的 `getTagList` 不受影響。後端部分要手動發布新版本才生效。

## home.html「隨機抽待辦任務」上班時間不抽 H（2026-11-02）

平日（週一～週五）台灣時間 08:00–16:00（16:00 起不算）按「抽一個」時，`drawNextTask()` 會先排除標題 `H` 開頭的任務（比對規則同 nonwork.html：不分大小寫、全形半形相同、忽略開頭空白），進度數字也只算排除後的清單。其他時間照舊全部抽。純前端改動，merge 進 main 就生效；Highlight 抽到 Google Task 時不套用這個規則。

all.html 也套用同一規則（2026-11-02）：上班時間 `applyFilter()` 把「待辦」來源（Google Tasks）裡 `H` 開頭的任務排除，「全部」「待辦」篩選、隨機一項、翻頁、朗讀、上方 📋 數字都不含它們；多方禱告等其他來源不受影響。頁面開著跨過 08:00／16:00 時，每分鐘檢查一次會自動重新套用（朗讀中先不動）。

## all.html「習慣」納入額外日曆（2026-11-04）

除了 primary 日曆今天的行程，all.html 的「習慣」另外納入 `HABIT_EXTRA_CALENDAR_IDS`（`禱告卡部署.gs`，目前是 `4a3fca26…@group.calendar.google.com`）：重複行程只列今天那一次（2026-11-12 起，兩個日曆的重複行程都要「開始日期是今天」才列，前一天開始、跨到今天的不列；後端比對 item 的 `startDate`）；不重複行程從過去到今天（開始時間在今天結束前）全部列出。all.html 打 `getTodayCalendarEvents&withExtra=true`，calendar.html 不帶參數不受影響。額外日曆的項目帶 `calendarId`，改標題／週期／刪除會帶著它打到正確日曆。標題含 `🍅` 或「任務進度」的行程（兩個日曆都算）會被排除（`HABIT_EXCLUDE_TITLE_KEYWORDS`）。後端部分要手動發布新版本才生效。

## all.html 完成按鈕防誤觸（2026-11-04）

使用者在捷運上（手機晃動／口袋誤觸）兩次一口氣完成幾十項（11/4 一次 29＋12 項）。原因：「✅ 完成」位置固定，完成後下一項立刻出現在同一位置，連續誤觸就連續完成。現在 `completionAllowed()` 擋兩件事：新項目顯示未滿 2 秒按完成不算；30 秒內已完成 4 項就暫停完成到視窗過去。「完成」「禱告更多／更少」都經過它。誤觸完成的可用「📜 操作歷程」的「復原」還原。

**真正原因（2026-11-04 下午確認）**：使用者說沒誤觸，操作歷程顯示同一秒（13:31:07–08）完成好幾項——是「🔊 開始朗讀」連禱（純朗讀模式關掉時會邊唸邊完成）。手機語音引擎出錯／被打斷時 `onerror`／`onend` 立刻觸發，以前一律當唸完，迴圈一秒完成好幾項，而且不經過 `completionAllowed()`。現在 `speakOnePass()` 回傳是否真的唸出來（要有 `onstart` 且唸超過 `SPEAK_MIN_MS` 800ms），沒唸出來就停止連禱、這項不標記完成。index.html 的連禱同日一起改成同樣規則。

## home.html「🆕 最新輸入的禱告」（2026-11-05）

首頁最下面的區塊（2026-11-05 移到按鈕列下方，上面是嵌入的 PUSH Google 表單 iframe `1FAIpQLSf9mM8…/viewform?embedded=true`，送出後 iframe 重新載入時 3 秒後自動重抓清單）：掃描「表單回覆 1」全部列，**依 A 欄時間戳記由新到舊**排序取前 100 筆（2026-11-05 使用者指定，不要改回依列號；沒有時間戳記的排最後），畫面一次顯示 5 條（每條固定高度 84px，最多兩行文字），其餘在框內捲動。每條下方顯示時間戳記（沒有的話顯示列號）、週期、標籤、備註。`addItem`（add-item.html 等）新增時也會寫 A 欄時間戳記（同日起；之前新增的那些沒有時間）。後端 action `getRecentItems&limit=100`（上限 100），要手動發布新版本才生效。

2026-11-14：清單每一條可以點一下，就在原地展開編輯（事項／週期／標籤／備註），按「儲存」只送有改的欄位：`updateTextByRow`／`updateCycleByRow`／`updateTagByRow`／新增的 `updateNoteByRow`（D 欄），都帶 `expect`（目前文字）讓後端確認列號。編輯中時表單送出後的自動重抓會跳過。`updateNoteByRow` 是後端新 action，要手動發布新版本才能改備註（其他三欄現有版本就能用）。

## all.html「✨ AI整理」（2026-11-06，`AI整理.gs`）

卡片文字框右上方的小按鈕（只在文字可編輯的來源顯示）：打 action `aiTidyText` → 後端用 Claude API（`claude-opus-5-5`、effort `low`、`fallbacks: "default"`）整理文字（加標點、去口語贅字、修語音辨識錯字，不改原意），前端 `confirm` 預覽後才套用，套用走一般改文字流程（可在操作歷程復原）。旁邊「💳 查儲值」打 `checkClaudeCredit`：Claude API 沒有查餘額的端點，是送一個最小請求，回 400「credit balance is too low」就是沒儲值；實際餘額要到 platform.claude.com → Billing 看。API key 存指令碼屬性 `CLAUDE_API_KEY`（不進 repo）。部署網址公開，所以限制每段 3000 字、每天 100 次（`AI_TIDY_USAGE`）。`appsscript.json` 加了 `script.external_request` scope：第一次要在編輯器手動執行 `checkClaudeCredit()` 授權，再發布新版本才生效。

## all.html「💬 LINE」篩選（2026-11-09）

篩選列在「📋 待辦」右邊多一顆「💬 LINE」：把 Google Tasks 裡 linelog 建立的任務（標題符合 `^1 名字：`，即 `LINELOG_PREFIX` + 名字 + `LINELOG_SEP`）從「待辦」分出來。純前端：項目的 `source` 仍是 `task`（完成／改標題等動作不變），只有篩選與上方計數用 `filterKeyOf()` 分成 `task`／`line`（📋／💬 各自計數）。標題被手動改掉 `1 ` 前綴的會回到「待辦」。

## all.html 篩選鈕點擊規則（2026-11-11）

「全部」狀態下點任一來源（習慣／網絡／多方／待辦／LINE）＝只顯示那一項；接著再點別的來源＝加進去（接連點兩項＝只顯示這兩項），再點已選的＝拿掉（至少留一項）。按「全部」回到全選。純前端，merge 進 main 就生效。

## all.html「習慣」時間標示（2026-11-11）

卡片白框右上角（跟左上「為習慣禱告」同一排），目前卡片是「習慣」時顯示一個標籤：`🔁 重複行程`（有 `recurringEventId`）、`⏪ 過去（yyyy/MM/dd，N 天前）`、`📍 今天`、`⏩ 未來`。純前端判斷（`habitWhenOf()`）：額外日曆的不重複行程 `time` 帶日期（`yyyy/MM/dd HH:mm`），拿來跟今天比；primary 日曆的 `time` 只有時間，一定是今天。不用重新發布 Apps Script。

## all.html 朗讀含備註（2026-11-12）

「🔊 開始朗讀」唸的是卡片文字＋備註（`speakTextOfCard()`：文字。備註，再接遍數）。備註取畫面上的備註框（有顯示才唸），所以網絡禱告的姓名後面會接著唸備註。純前端，merge 進 main 就生效。

## all.html 朗讀改用 Zephyr（2026-11-17）

all.html（GitHub Pages）的「🔊 開始朗讀」也改用 Gemini TTS Zephyr：程式跟 dg-network `AllCard.html` 同一套（同一段文字只抓一次、遍數另外快取、預抓下一項、取不到就該遍改用瀏覽器語音、連續失敗 3 次整頁改回瀏覽器語音），語音直接 POST 到 dg-network 的部署網址（`ZEPHYR_TTS_URL = NETWORK_API_URL`，用那邊的 `GEMINI_API_KEY`，主要專案不用另外設 key）。從 github.io 跨網域 POST `text/plain` 可行（2026-11-17 實測）。兩個頁面共用每天次數上限，所以 `ZEPHYR_DAILY_LIMIT` 調成 3000。

加速（同日）：文字依句號切段（`splitForTts`，第一段 ≤24 字先產生先播，其餘 ≤120 字一段同時在背景產生）；卡片停留 1.2 秒就背景預抓這張卡的語音（`scheduleZephyrPrefetch`，在 `renderFromView` 呼叫），朗讀中也預抓下一張；抓過的語音存在瀏覽器 IndexedDB `zephyrTts`（以文字為 key，最多 300 段，超過刪最舊），遍數 1～7 開頁面 3 秒後就備好。實測（模擬）按下到出聲：沒預抓約 0.9 秒、有預抓／已存 0.05 秒。all.html 與 `AllCard.html` 的 Zephyr 區塊是同一份程式，改一邊要同步另一邊。注意：預抓會多用一些每日次數（翻過停留的卡片都會抓）。

**改用 Google Cloud Text-to-Speech（2026-11-18）**：Gemini TTS 在 Tier 1 每天只能 100 次（`generate_requests_per_model_per_day`，11/17 晚上用完後全部退回內建聲音，使用者聽起來「不是 Zephyr」）。`Zephyr朗讀.js` 現在優先用 Cloud TTS Chirp 3 HD `cmn-CN-Chirp3-HD-Zephyr`（中文只有 cmn-CN；每月前 100 萬字免費，之後每 100 萬字 30 美元；每次請求 ≤5000 bytes，所以截 1500 字），回 MP3（`format: 'mp3'`，前端直接當 audio/mpeg 播）；指令碼屬性 `CLOUD_TTS_API_KEY` 沒設或 Cloud 失敗才退回 Gemini（`engine: 'gemini'` 可強制 Gemini）。設好 key 後在 dg-network 編輯器執行 `checkCloudTts()` 確認。前端遇到 429／額度錯誤就整頁改用內建聲音並顯示「今天 Zephyr 語音額度用完了」。

**聲音改成 Gacrux（2026-11-18）**：使用者聽過 Google Cloud 大陸版 8 種聲音後選 Gacrux（成熟、播音員感）。前端常數 `TTS_VOICE`（all.html／AllCard.html 各一份）送 `voice` 給後端，IndexedDB／記憶體快取的 key 是「聲音|文字」，換聲音後舊聲音的快取不會再用到；後端預設 `ZEPHYR_VOICE_NAME` 也改成 Gacrux。程式裡的 Zephyr 字樣（函式名、`Zephyr朗讀.js`）是沿用舊名，實際聲音以 `TTS_VOICE` 為準。

## all.html 網絡禱告「📋 輸出到 Tasks」「🎲 抉擇」（2026-11-16）

網絡卡片（`source === 'network'`）在「匯出到表單回覆1」下方多一排兩顆按鈕：「📋 輸出到 Tasks」（按兩下確認）把姓名加前綴 `1`（跟多方禱告「複製到 Tasks」一樣，`1` 後面沒有空格）當標題、備註框內容當 notes，複製到 Google Tasks 預設清單；只複製，網絡那邊的項目不完成、不刪除。後端是禱告卡的新 action `copyTextToTasks`（`title`、`note`，任務由禱告卡專案建立，之後改得動），不重試（避免重複建任務），**要手動發布新版本才生效**。「🎲 抉擇」純前端 50-50 抽「✅ 輸出／❌ 不輸出」，只顯示結果，換項目就清掉。

## all.html 篩選記憶（2026-11-16）

篩選列選了哪些來源（`activeSources`）存在 localStorage `allHtml_activeSources`，重新整理後接續同樣的篩選（只記這台裝置）。按「全部」也會記成全選。純前端，merge 進 main 就生效。

## all.html 待辦／LINE「🌐 加入禱告網絡」（2026-11-17）

待辦（含 💬 LINE）卡片的按鈕列多一顆「🌐 加入禱告網絡」：把這個人加進 dg-network 的「表單回覆 1」。姓名自動取標題裡第一段引號（`"呂信偉"`、`“呂信偉”`、`「呂信偉」`），沒有引號就取去掉 `1 ` 前綴後第一個冒號前的文字，按下會跳視窗讓使用者確認／修改；其餘資訊（標題去掉 `1 `＋待辦備註）放 D 欄備註。後端 dg-network 新 action `addNetworkItem`（`name`、`note`、`cycle` 預設每月）：本次＝現在、下次依週期算（同代禱表單）；姓名已存在就不新增，只把備註接在原備註後面（內容已在就不重複接）。待辦本身不動。操作歷程記為「加入禱告網絡」，不提供復原。

## all.html 網絡禱告可改姓名（2026-11-18）

網絡卡片的姓名（卡片大字）現在可以直接編輯（停 1 秒自動存，跟其他來源改文字一樣），備註本來就可編輯。後端 dg-network 新 action `updateNameByRow`（`expect`＝改之前的姓名，`resolveRowByName_` 確認列號），同時把「分眾負責」分頁裡同名的負責紀錄改成新姓名（分眾用姓名對應）。姓名清空不送出；網絡卡片不顯示「✨ AI整理」。操作歷程記為「改姓名」，可復原。後端靠 workflow 自動發布 dg-network 新版本。

## 「📅 加入日曆」一律不重複行程（2026-11-19）

all.html／index.html／query.html／today.html／nonwork.html 的「加入日曆」都改成固定建立**不重複**行程：不再依週期帶 `recur`（RRULE），today／nonwork／all 的待辦也不再跳視窗問週期，index／query 週期沒設定也能加入。要重複的話在 Google 日曆編輯畫面自己設。純前端，merge 進 main 就生效。

## all.html 朗讀時語音指令（2026-11-20）

「純朗讀模式」下面多一個開關「🎤 朗讀時聽語音指令」（**預設開啟**，關掉才在 localStorage `allHtml_voiceCmd` 記 `0`）。打開後按「🔊 開始朗讀」會同時開麥克風（藍牙耳機的麥克風）聽：「更多」「更少」「完成」「下一項」＝按禱告更多／禱告更少／完成／下一項按鈕（按鈕沒顯示就不做），「停止」（或「暫停」）＝按停止朗讀鈕、麥克風一起關，「安祺」＝把這項標籤設成 `A安祺禱告`（多方禱告本來就不顯示這個標籤，所以設完直接從清單移走、接著唸下一項；「安琪」等同音字也算）。只在朗讀進行中才執行，同一指令 2.5 秒內不重複。2026-11-20 改成短指令（更多／更少／完成／下一項／安祺／停止），句子裡出現這些詞就算，舊的長說法也還認得。用瀏覽器 `SpeechRecognition`（`zh-TW`，Android Chrome），**沒用 Gemini Live**：Live API 要把 key／臨時 token 放進公開網頁、且 Gemini 免費層每天次數很少。Android 辨識沒聲音幾秒會自己結束，`onend` 時朗讀還在就重開。**一陣子後不聽了（2026-11-20 修）**：`start()` 重開時丟錯被吞掉就不再重開、或 Android 卡住不觸發 `onend`、或螢幕暗掉時回 `not-allowed` 就把開關關掉。現在有看門狗（每 3 秒）：沒在跑就重開，「在跑」但 20 秒沒任何事件就 `abort()` 重開；`start()` 丟錯 1 秒後重試；`not-allowed` 只有 `navigator.permissions` 查到麥克風是 denied 才關開關；回到前景（`visibilitychange`）也會重開。開關下面顯示「🎤 聆聽指令中…／重新聆聽中…」。純前端，merge 進 main 就生效。注意：用藍牙麥克風時耳機會切到通話模式（音質變差），喇叭外放時朗讀內容若含「完成」可能被聽成指令。

## 朗讀不唸網址（2026-11-20）

all.html 與 dg-network `AllCard.html` 朗讀時，卡片文字／備註裡的網址（`http(s)://…`、`www.…`）不唸出來，改唸「有網址」（`speakableText()`，`speakTextOfCard()`／`textOfItem()` 都套用）。all.html 純前端 merge 進 main 就生效；AllCard.html 靠 workflow 自動發布 dg-network。

## 長內容朗讀（2026-11-20）

all.html 與 `AllCard.html`（同一份 Zephyr 程式）：備註很長時以前會把十幾段同時打 Apps Script，部分逾時／失敗就把剩下整段改用內建聲音。現在 `zephyrEnqueue()` 同時最多 3 個 TTS 請求（`ZEPHYR_MAX_INFLIGHT`），正在唸的段落（`getZephyrClip(text, true)`）優先於預抓；每段失敗自動重試一次（額度錯誤不重試）；仍失敗只有那一段改用內建聲音，後面照樣 Zephyr。`splitForTts` 另外把超過 120 字的單句依逗號／空白再切、還太長就硬切。

長內容「卡住」（同日）：Android Chrome 內建語音唸很長一段時常常唸到一半就停、永遠不觸發 `onend`，連禱就一直等。現在 `speakOnePassBrowser` 也用 `splitForTts` 切短段逐段唸（`speakUtterOnce`），每段看門狗＝8 秒＋每字 0.45 秒，超過就 `cancel()` 當這段結束；`playClip` 也有看門狗（15 秒沒開始播放棄、開始後超過音檔長度＋5 秒當播完）；TTS 請求逾時從 60 秒改 25 秒；等語音超過 3 秒畫面顯示「語音準備中…（第 i／n 段）」。

跟語音指令互相干擾（同日）：Android 每次重開語音辨識會搶一下音訊（藍牙切通話模式），正在播的音檔被系統暫停（沒有 ended／error）或 `play()` 被拒絕，朗讀就停住或中斷。`playClip` 現在：`onpause` 不是自己停的就 0.4 秒後接著播（最多 8 次），`play()` 被拒絕重試 3 次，看門狗依剩餘長度重算；內建語音 `interrupted` 錯誤若已開始唸就當這段唸過（不讓連禱停掉）。all.html 語音辨識重開至少間隔 2 秒（`VOICE_MIN_RESTART_MS`）。要判斷是不是語音指令造成的，可以先關掉「🎤 朗讀時聽語音指令」比較。

## query.html 依標籤查詢：複選＋清單（2026-11-21）

標籤膠囊改成可複選（點一下選、再點一下取消），按「查詢」才查；旁邊「清除」取消全部。多個標籤是「或」：前端每個標籤各打一次 `getItemsByTag&all=true`，依列號去重、依日期排序（後端不用改）。預設像關鍵字查詢一樣列出清單（含未到期，顯示標籤・日期，點一下進編輯面板），上方「🃏 用卡片瀏覽已到期的 N 筆」＝原本點標籤直接進卡片的行為；「全部輸出」「全部查詢」兩個勾選照舊（套用在所有選取的標籤）。純前端，merge 進 main 就生效。

## home.html「禱告卡片查詢」移到上方卡片（2026-11-22）

上方卡片區原本「🎲 隨機抽待辦任務」的位置改成「🔍 禱告卡片查詢」（連到 query.html）；隨機抽待辦任務改成下方按鈕列的一顆按鈕（同樣 `id="drawTaskBtn"`，功能不變，抽到的結果仍顯示在按鈕列上方）。純前端，merge 進 main 就生效。
