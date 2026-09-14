/**
 * 每天凌晨 2–3 點，把「非今日」Google Tasks 清單的所有 task
 * 新增到試算表 B 欄（標題，去掉週期前綴）、C 欄（週期代碼）、D 欄（詳細資料），
 * 然後清空「非今日」清單。
 *
 * 標題若帶「週期-」前綴（例如「每季-同工會：...」），會拆掉前綴、把週期欄（C欄）
 * 設成對應代碼（例如 S每季），呼應主要 prayer-card 專案「複製到 Tasks」會把週期
 * 加到標題前綴的行為（見 禱告卡部署.gs 的 copyRowToDefaultTaskList_）。
 * 容錯：「週/周」「兩/二」視為同一個字。
 *
 * 注意：這裡的 B/C/D 欄位對應跟主要 prayer-card 專案（禱告卡部署.gs 的 COL）一致
 * （B=事項、C=週期、D=備註）。原始版本把 notes 寫進 C 欄，跟這個欄位配置衝突，
 * 這次一併修正成寫進 D 欄。
 */

const SHEET_ID        = '1h6ptOLTHHZfUXvjOlZxsYrCSoL1Jp2DBNexYdy_g75Y';
const SHEET_NAME      = '表單回覆 1';
const SOURCE_LIST_NAME = '非今日';

const CYCLE_MAP = {
  'D': 'D每天', '2': '2每兩天', '3': '3每三天', '4': '4每四天', '5': '5每五天',
  'W': 'W每週', 'DW': 'DW每兩週',
  'M': 'M每月', '2M': '2M每兩個月', 'S': 'S每季', 'HY': 'HY每半年', 'Y': 'Y每年'
};

// 把 CYCLE_MAP 的值（如 'S每季'）去掉開頭的代號，換成純中文（如 '每季'）當 key，
// 用來比對 Google Tasks 標題前綴（例如「每季-同工會」）該對應哪個週期代碼。
const CYCLE_PLAIN_LABEL_MAP_ = (function () {
  const map = {};
  Object.keys(CYCLE_MAP).forEach(code => {
    const label = CYCLE_MAP[code];
    const plain = label.replace(/^[A-Za-z0-9]+/, '');
    if (plain) map[plain] = label;
  });
  return map;
})();

// 常見異體字容錯：週/周、兩/二 視為同一個字，比對前綴時先正規化再查表
function normalizeCyclePrefixText_(text) {
  return text.replace(/周/g, '週').replace(/二/g, '兩');
}

/**
 * 解析 Google Tasks 標題開頭的「週期-」前綴（例如「每季-同工會：...」）。
 * 有對應到週期就回傳 { cycle, text }（text 是去掉前綴後的標題)，沒有就回傳 null。
 */
function extractCyclePrefixFromTitle_(title) {
  const match = title.match(/^([一-龥]+)-(.*)$/);
  if (!match) return null;
  const cycle = CYCLE_PLAIN_LABEL_MAP_[normalizeCyclePrefixText_(match[1])];
  if (!cycle) return null;
  const text = match[2].trim();
  if (!text) return null;
  return { cycle: cycle, text: text };
}

// ── 主程式 ───────────────────────────────────────────────
function exportAndClearNonToday() {
  const sourceList = findListByName(SOURCE_LIST_NAME);
  if (!sourceList) {
    Logger.log(`清單「${SOURCE_LIST_NAME}」不存在，略過`);
    return;
  }

  // 1. 撈所有未完成 task（記錄 id 以便後續刪除）
  const tasks = [];
  let pageToken = null;

  do {
    const params = { showCompleted: false, showHidden: false, maxResults: 100 };
    if (pageToken) params.pageToken = pageToken;

    const res = Tasks.Tasks.list(sourceList.id, params);
    for (const task of res.items || []) {
      if (task.parent) continue; // 子任務隨父任務刪除，不單獨處理
      tasks.push(task);
    }
    pageToken = res.nextPageToken;
  } while (pageToken);

  if (tasks.length === 0) {
    Logger.log('「非今日」清單沒有任何 task，略過');
    return;
  }

  // 2. 寫入試算表：B 欄（標題，去掉週期前綴）、C 欄（週期代碼）、D 欄（詳細資料）
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    Logger.log(`找不到工作表「${SHEET_NAME}」`);
    return;
  }

  const startRow = sheet.getLastRow() + 1;
  const data = tasks.map(t => {
    const rawTitle = (t.title || '').trim();
    const prefixInfo = extractCyclePrefixFromTitle_(rawTitle);
    const title = prefixInfo ? prefixInfo.text : rawTitle;
    const cycle = prefixInfo ? prefixInfo.cycle : '';
    return [title, cycle, t.notes || ''];
  });
  sheet.getRange(startRow, 2, data.length, 3).setValues(data);
  Logger.log(`已寫入 ${tasks.length} 筆，從第 ${startRow} 列開始`);

  // 3. 刪除「非今日」清單裡的所有 task（子任務會一併刪除）
  for (const task of tasks) {
    Tasks.Tasks.remove(sourceList.id, task.id);
  }
  Logger.log(`已清空「${SOURCE_LIST_NAME}」清單`);
}

// ── 依名稱尋找清單 ────────────────────────────────────────
function findListByName(name) {
  const lists = Tasks.Tasklists.list({ maxResults: 100 });
  return (lists.items || []).find(l => l.title === name) || null;
}

// ── 建立凌晨 2–3 點觸發器（只需執行一次）───────────────
function setupExportTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'exportAndClearNonToday')
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('exportAndClearNonToday')
    .timeBased()
    .everyDays(1)
    .atHour(2)
    .create();

  Logger.log('觸發器已建立：每天凌晨 2–3 點執行');
}

// ── 手動測試（不寫入、不刪除，只列出會處理什麼）───────────────
function dryRun() {
  const sourceList = findListByName(SOURCE_LIST_NAME);
  if (!sourceList) { Logger.log(`清單「${SOURCE_LIST_NAME}」不存在`); return; }

  const res   = Tasks.Tasks.list(sourceList.id, { showCompleted: false, showHidden: false });
  const tasks = (res.items || []).filter(t => !t.parent);
  Logger.log(`「${SOURCE_LIST_NAME}」共 ${tasks.length} 個 task：`);
  tasks.forEach(t => Logger.log(`  - ${t.title}`));

  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
  Logger.log(`試算表目前最後一列：第 ${sheet.getLastRow()} 列，下次從第 ${sheet.getLastRow() + 1} 列寫入`);
}
