/**
 * 禱告卡片 - Apps Script Web App 後端
 * 部署方式：擴充功能 → Apps Script → 部署 → 新增部署作業 → 網頁應用程式
 *   執行身份：我（你的帳號）
 *   誰能存取：任何人
 * 部署後複製「網頁應用程式網址」，貼到 index.html 裡的 API_URL
 */

const SHEET_NAME = '表單回覆 1';
const CARD_SHEET_NAME = '禱告卡片';

// 欄位對應（1-indexed，跟 getRange 的欄位編號一致）
const COL = {
  TEXT: 2,   // B欄：事項
  CYCLE: 3,  // C欄：DG 週期
  NOTE: 4,   // D欄：備註
  DATE: 5,   // E欄：本次禱告時間
  DONE: 6,   // F欄：本次禱告完成
  TAG: 8     // H欄：標籤
};

const CYCLE_MAP = {
  'D': 'D每天', '2': '2每兩天', '3': '3每三天', 'W': 'W每週', 'DW': 'DW每兩週',
  'M': 'M每月', '2M': '2M每兩個月', 'S': 'S每季', 'HY': 'HY每半年', 'Y': 'Y每年'
};

const TAG_MAP = {
  'G': 'G工作日', 'W': 'W週末', 'F': 'F家庭會議', 'A': 'A安祺禱告'
};

// 各週期對應的天數區間，用來把同週期的項目均勻分散到不同天
const CYCLE_PERIOD_DAYS = {
  'D每天': 1,
  '2每兩天': 2,
  '3每三天': 3,
  'W每週': 7,
  'DW每兩週': 14,
  'M每月': 30,
  '2M每兩個月': 60,
  'S每季': 90,
  'HY每半年': 182,
  'Y每年': 365
};

/**
 * 掃描「表單回覆 1」，回傳「E欄是空白，或日期 <= 今天」的實際工作表列號清單（依原本列順序）。
 * 禱告卡片（手機版 + Google Sheet 版）都只在這份清單裡翻頁，
 * 已經完成、E欄被推到未來日期的項目會暫時消失，直到排定日期到了才會再出現。
 */
function getFilteredList_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const numRows = lastRow - 1;
  const dates = sheet.getRange(2, COL.DATE, numRows, 1).getValues();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const rows = [];
  for (let i = 0; i < dates.length; i++) {
    const val = dates[i][0];

    if (val === '' || val === null || val === undefined) {
      rows.push(i + 2); // E欄空白 → 算需要禱告
      continue;
    }

    if (val instanceof Date && !isNaN(val.getTime())) {
      const d = new Date(val);
      d.setHours(0, 0, 0, 0);
      if (d.getTime() <= today.getTime()) {
        rows.push(i + 2); // 日期 <= 今天 → 算需要禱告
      }
    }
  }
  return rows;
}

/**
 * 把 E 欄的日期依照該列 C 欄的週期往後推進一個週期天數。
 * 例如 Y每年 就 +365 天。若 E 欄原本沒有有效日期，就用今天當基準。
 */
function advancePrayerDate_(sheet, row) {
  const cycle = sheet.getRange(row, COL.CYCLE).getValue().toString().trim();
  const period = CYCLE_PERIOD_DAYS[cycle] || 1;

  const dateCell = sheet.getRange(row, COL.DATE);
  let baseDate = dateCell.getValue();
  if (!(baseDate instanceof Date) || isNaN(baseDate.getTime())) {
    baseDate = new Date();
    baseDate.setHours(0, 0, 0, 0);
  }

  const newDate = new Date(baseDate);
  newDate.setDate(newDate.getDate() + period);

  dateCell.setValue(newDate);
  dateCell.setNumberFormat('yyyy/MM/dd');
}

/**
 * 標記某一列「本次禱告完成」：F 欄打上 Y → 推進 E 欄日期 → 清空 F 欄。
 * row 是「表單回覆 1」實際的工作表列號。
 */
function markDone_(sheet, row) {
  sheet.getRange(row, COL.DONE).setValue('Y');
  advancePrayerDate_(sheet, row);
  sheet.getRange(row, COL.DONE).setValue('');
  recordPrayerCompleted_();
}

// 今日完成計數器：存在 PropertiesService（跟試算表綁定），日期不是今天就視同歸零重算
const PRAYER_PROGRESS_DATE_KEY_ = 'PRAYER_PROGRESS_DATE';
const PRAYER_PROGRESS_COUNT_KEY_ = 'PRAYER_PROGRESS_COUNT';

function recordPrayerCompleted_() {
  const props = PropertiesService.getDocumentProperties();
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const storedDate = props.getProperty(PRAYER_PROGRESS_DATE_KEY_);
  const count = (storedDate === today ? parseInt(props.getProperty(PRAYER_PROGRESS_COUNT_KEY_) || '0', 10) : 0) + 1;

  props.setProperty(PRAYER_PROGRESS_DATE_KEY_, today);
  props.setProperty(PRAYER_PROGRESS_COUNT_KEY_, String(count));
}

/**
 * 今日禱告完成率：已完成數（今天累計標記完成的次數）÷（已完成數 + 目前還待禱告的項目數）。
 * 待禱告項目數沿用 getAllItems() 的邏輯，避免跟卡片畫面上看到的數字不一致。
 */
function getPrayerProgress_() {
  const props = PropertiesService.getDocumentProperties();
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const storedDate = props.getProperty(PRAYER_PROGRESS_DATE_KEY_);
  const completed = storedDate === today ? parseInt(props.getProperty(PRAYER_PROGRESS_COUNT_KEY_) || '0', 10) : 0;
  const remaining = getAllItems().total;
  const total = completed + remaining;

  return {
    completed: completed,
    remaining: remaining,
    total: total,
    rate: total > 0 ? Math.round((completed / total) * 100) : 100
  };
}

// 注意：這個函式故意不叫 onEdit，改用安裝式觸發器綁定（見下方 installEditTrigger），
// 因為簡易觸發器（函式剛好叫 onEdit）沒辦法存取 Tasks API 這種需要額外授權的服務。
function handleSpreadsheetEdit_(e) {
  const sheet = e.range.getSheet();
  const name = sheet.getName();

  if (name === CARD_SHEET_NAME) {
    handleCardEdit_(e);
    return;
  }

  if (name === SHEET_NAME) {
    handleDataSheetEdit_(e);   // F欄完成標記（只改儲存格值，不刪列，安全，先跑）
    handleTagExportEdit_(e);   // H欄週幾標籤複製到Google Tasks（不刪列）
    return;
  }
}

/**
 * 「表單回覆 1」分頁：偵測 F 欄是否被打上 Y。
 * 支援單格編輯，也支援一次貼上多列。
 * 改成批次讀取/寫入（一次 getValues + 一次 setValues），
 * 避免大量貼上（例如上百列）時，一列一列個別呼叫 API 導致簡易觸發器 30 秒逾時、只處理到一半。
 */
function handleDataSheetEdit_(e) {
  const range = e.range;
  const startCol = range.getColumn();
  const numCols = range.getNumColumns();

  if (COL.DONE < startCol || COL.DONE > startCol + numCols - 1) return;

  const sheet = range.getSheet();
  const startRow = range.getRow();
  const numRows = range.getNumRows();

  const firstDataRow = Math.max(startRow, 2); // 跳過標題列
  const lastDataRow = startRow + numRows - 1;
  if (firstDataRow > lastDataRow) return;

  const rowCount = lastDataRow - firstDataRow + 1;

  // 一次讀取整個範圍需要的三個欄位，取代逐列個別讀取
  const fValues = sheet.getRange(firstDataRow, COL.DONE, rowCount, 1).getValues();
  const cValues = sheet.getRange(firstDataRow, COL.CYCLE, rowCount, 1).getValues();
  const eValues = sheet.getRange(firstDataRow, COL.DATE, rowCount, 1).getValues();

  let changed = false;
  const newE = [];
  const newF = [];

  for (let i = 0; i < rowCount; i++) {
    const fVal = (fValues[i][0] || '').toString().trim().toUpperCase();

    if (fVal !== 'Y') {
      newE.push([eValues[i][0]]);
      newF.push([fValues[i][0]]);
      continue;
    }

    const cycle = (cValues[i][0] || '').toString().trim();
    const period = CYCLE_PERIOD_DAYS[cycle] || 1;

    let baseDate = eValues[i][0];
    if (!(baseDate instanceof Date) || isNaN(baseDate.getTime())) {
      baseDate = new Date();
      baseDate.setHours(0, 0, 0, 0);
    }

    const nextDate = new Date(baseDate);
    nextDate.setDate(nextDate.getDate() + period);

    newE.push([nextDate]);
    newF.push(['']); // 處理完清空這一列的F欄
    changed = true;
  }

  if (!changed) return;

  // 一次寫入整個範圍，取代逐列個別寫入
  const dateRange = sheet.getRange(firstDataRow, COL.DATE, rowCount, 1);
  dateRange.setValues(newE);
  dateRange.setNumberFormat('yyyy/MM/dd');
  sheet.getRange(firstDataRow, COL.DONE, rowCount, 1).setValues(newF);
}

// 標籤文字對應要複製到哪個 Google Tasks 清單（清單名稱可自行修改，兩邊要一致）
const WEEKDAY_TASK_LISTS = {
  '週一': '週一', '週二': '週二', '週三': '週三', '週四': '週四',
  '週五': '週五', '週六': '週六', '週日': '週日'
};

/**
 * 「表單回覆 1」分頁：偵測 H 欄（標籤）是否被打上「週一」～「週日」（人工在Sheet介面編輯時觸發）。
 * 支援單格編輯，也支援一次貼上多列。
 * 需要先在 Apps Script 專案啟用 Google Tasks API 服務，詳見部署說明。
 */
function handleTagExportEdit_(e) {
  const range = e.range;
  const startCol = range.getColumn();
  const numCols = range.getNumColumns();

  if (COL.TAG < startCol || COL.TAG > startCol + numCols - 1) return;

  const sheet = range.getSheet();
  const startRow = range.getRow();
  const numRows = range.getNumRows();

  const firstDataRow = Math.max(startRow, 2); // 跳過標題列
  const lastDataRow = startRow + numRows - 1;
  if (firstDataRow > lastDataRow) return;

  const rowCount = lastDataRow - firstDataRow + 1;
  const hValues = sheet.getRange(firstDataRow, COL.TAG, rowCount, 1).getValues();

  // 先找出這次編輯範圍裡，哪些列的標籤符合「週一」～「週日」
  const matchedRows = [];
  for (let i = 0; i < rowCount; i++) {
    const tagVal = (hValues[i][0] || '').toString().trim();
    if (WEEKDAY_TASK_LISTS[tagVal]) {
      matchedRows.push(firstDataRow + i);
    }
  }

  if (matchedRows.length === 0) return;

  matchedRows.forEach(row => {
    exportWeekdayTagIfMatched_(sheet, row);
  });
}

/**
 * 檢查某一列的H欄是否為週幾標籤，若是則複製到對應Google Tasks清單。
 * 不會刪除原始列——這一列會繼續保留在「表單回覆1」，也會繼續正常出現在禱告卡片清單裡。
 * 這是共用邏輯：不管是人工在Sheet編輯觸發的onEdit，還是手機版API寫入標籤，都呼叫這裡，
 * 確保兩邊行為一致（因為程式碼寫入儲存格不會觸發onEdit，手機版必須主動呼叫這個函式才會生效）。
 * 回傳 true 代表已成功複製到對應的 Google Tasks 清單。
 */
function exportWeekdayTagIfMatched_(sheet, row) {
  const tagVal = sheet.getRange(row, COL.TAG).getValue().toString().trim();
  const listName = WEEKDAY_TASK_LISTS[tagVal];
  if (!listName) return false; // 不是週幾標籤，不用處理

  const title = sheet.getRange(row, COL.TEXT).getValue().toString();
  const notes = sheet.getRange(row, COL.NOTE).getValue().toString();

  try {
    exportToGoogleTask_(listName, title, notes);
    return true;
  } catch (err) {
    Logger.log('複製到 Google Task 失敗（列 ' + row + '）：' + err.toString());
    return false;
  }
}

function exportToGoogleTask_(listName, title, notes) {
  const list = findOrCreateTaskList_(listName);
  Tasks.Tasks.insert({
    title: title || '（無標題）',
    notes: notes || ''
  }, list.id);
}

function findOrCreateTaskList_(name) {
  const lists = Tasks.Tasklists.list({ maxResults: 100 });
  const found = (lists.items || []).find(l => l.title === name);
  if (found) return found;
  return Tasks.Tasklists.insert({ title: name }); // 清單不存在就自動建立，不用你自己先手動開好
}

/**
 * 實際執行複製動作：把指定列的事項複製到 Google Tasks 預設清單（不檢查標籤、不刪除原始列）。
 * 這是共用的底層邏輯，被「標籤自動觸發」（copyToDefaultTaskListIfTagged_）
 * 跟「手機版手動按鈕」（copyCurrentRowToTasks）兩種情境呼叫。
 */
function copyRowToDefaultTaskList_(sheet, row) {
  const title = sheet.getRange(row, COL.TEXT).getValue().toString();
  const notes = sheet.getRange(row, COL.NOTE).getValue().toString();

  try {
    const taskLists = Tasks.Tasklists.list({ maxResults: 1 });
    if (!taskLists.items || taskLists.items.length === 0) {
      Logger.log('找不到任何 Google Tasks 清單，無法複製（列 ' + row + '）');
      return false;
    }
    const defaultListId = taskLists.items[0].id;

    Tasks.Tasks.insert({
      title: title || '（無標題）',
      notes: notes || ''
    }, defaultListId);

    return true;
  } catch (err) {
    Logger.log('複製到 Google Tasks 預設清單失敗（列 ' + row + '）：' + err.toString());
    return false;
  }
}

/**
 * 檢查某一列的H欄是否為「task預設清單」，若是則複製到 Google Tasks 的預設清單（不刪除原始列）。
 * 由標籤變更時自動觸發（updateFieldByRow）。
 * 注意：<select> 的 change 事件只有在「值真的改變」時才會觸發，
 * 所以這個自動複製只在「從其他標籤切換成task預設清單」的那一刻生效；
 * 如果標籤本來就已經是task預設清單，要用下方 copyCurrentRowToTasks 的手動按鈕才能再次複製。
 */
function copyToDefaultTaskListIfTagged_(sheet, row) {
  const tagVal = sheet.getRange(row, COL.TAG).getValue().toString().trim();
  if (tagVal !== 'task預設清單') return false;
  return copyRowToDefaultTaskList_(sheet, row);
}

/**
 * 手動觸發版：不管H欄標籤目前是什麼值，都直接複製這一列到 Google Tasks 預設清單。
 * 給手機版前端「📋 複製到 Google Tasks 預設清單」按鈕使用，
 * 解決「標籤本來就已經是task預設清單、change事件不會觸發」的限制，可以隨時重複按、重複複製。
 */
function copyCurrentRowToTasks(row) {
  if (!row || row < 2) return { success: false };
  const sheet = getSheet_();
  const copied = copyRowToDefaultTaskList_(sheet, row);
  return { success: copied, copied: copied };
}

/**
 * 診斷用函式：確認 Tasks API 本身有沒有正確啟用、帳號授權有沒有問題。
 * 這個函式手動執行沒問題，但不代表 onEdit 就能用（見下方 installEditTrigger 的說明）。
 * 執行方式：函式下拉選單選 authorizeTasksAccess → 執行 ▶
 */
function authorizeTasksAccess() {
  const lists = Tasks.Tasklists.list({ maxResults: 10 });
  safeAlert('✅ Tasks API 本身運作正常！目前你的 Google Tasks 清單數量：' + ((lists.items || []).length));
}

/**
 * 【必須執行一次】安裝「安裝式觸發器」，取代原本的簡易觸發器。
 * 簡易觸發器（函式剛好叫 onEdit）沒辦法存取 Tasks API 這種需要額外授權的服務，
 * 這是 Google Apps Script 的硬性限制，不管手動授權幾次都沒用。
 * 安裝式觸發器則是帶著完整授權運作，才能真正呼叫 Tasks API。
 *
 * 執行方式：函式下拉選單選 installEditTrigger → 執行 ▶
 * 第一次執行會跳出完整授權畫面（包含 Tasks 權限），照樣點繼續 → 允許。
 * 只需要執行這一次，之後不用再跑。
 */
function installEditTrigger() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // 先清掉舊的同名觸發器，避免重複安裝造成同一次編輯觸發兩次
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'handleSpreadsheetEdit_')
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('handleSpreadsheetEdit_')
    .forSpreadsheet(ss)
    .onEdit()
    .create();

  safeAlert('✅ 安裝式觸發器已建立完成！現在 H欄週幾標籤自動複製到 Google Tasks 的功能應該可以正常運作了，請重新測試。');
}

/**
 * 「禱告卡片」分頁：G1（跳項）、B10（上一項）、B12（下一項）。
 * 「下一項」會先把目前這項標記完成，可能因此離開今日清單，再依新的清單前進。
 */
function handleCardEdit_(e) {
  const a1 = e.range.getA1Notation();
  const cardSheet = e.range.getSheet();

  if (a1 === 'G1') {
    const dataSheet = getSheet_();
    const rows = getFilteredList_(dataSheet);
    const total = rows.length;

    if (total === 0) {
      refreshCardText_(cardSheet, dataSheet, 0);
      return;
    }

    let idx = e.range.getValue();
    if (!idx || idx < 1) {
      idx = 1;
      e.range.setValue(1);
    } else if (idx > total) {
      idx = total;
      e.range.setValue(total);
    }

    refreshCardText_(cardSheet, dataSheet, idx);
    return;
  }

  if (a1 === 'B10') {
    if (e.range.getValue() === true) {
      goPrevCard_(cardSheet);
      e.range.setValue(false);
    }
    return;
  }

  if (a1 === 'B12') {
    if (e.range.getValue() === true) {
      goNextCard_(cardSheet);
      e.range.setValue(false);
    }
    return;
  }

  // B20：刪除目前這項（不可復原），需要二次確認，避免誤觸
  if (a1 === 'B20') {
    if (e.range.getValue() === true) {
      e.range.setValue(false); // 先取消勾選，避免殘留勾選狀態
      const ui = SpreadsheetApp.getUi();
      const response = ui.alert(
        '確定要刪除這一項嗎？',
        '這個動作無法復原，會直接從「表單回覆 1」刪除這筆資料。',
        ui.ButtonSet.YES_NO
      );
      if (response === ui.Button.YES) {
        deleteCurrentCardItem_(cardSheet);
      }
    }
    return;
  }

  // B4 手動編輯 → 同步寫回表單回覆1對應列的 B 欄（用篩選後清單找出正確的實際列號）
  if (a1 === 'B4') {
    const dataSheet = getSheet_();
    const rows = getFilteredList_(dataSheet);
    const idx = cardSheet.getRange('G1').getValue();
    if (idx >= 1 && idx <= rows.length) {
      dataSheet.getRange(rows[idx - 1], COL.TEXT).setValue(e.range.getValue());
    }
    return;
  }

  // D6 週期欄位自動校正 → 寫回 C 欄（用篩選後清單找出正確的實際列號）
  if (a1 === 'D6') {
    let newValue = e.range.getValue();
    if (!newValue) return;
    newValue = newValue.toString().trim().toUpperCase();

    const matched = CYCLE_MAP[newValue];
    if (matched) {
      if (matched !== e.range.getValue()) e.range.setValue(matched);
      newValue = matched;
    } else {
      newValue = e.range.getValue().toString();
    }

    const dataSheet = getSheet_();
    const rows = getFilteredList_(dataSheet);
    const idx = cardSheet.getRange('G1').getValue();
    if (idx >= 1 && idx <= rows.length) {
      dataSheet.getRange(rows[idx - 1], COL.CYCLE).setValue(newValue);
      refreshCardText_(cardSheet, dataSheet, idx); // 同步刷新 B6 顯示
    }
    return;
  }

  // D13 標籤欄位自動校正 → 寫回 H 欄（用篩選後清單找出正確的實際列號）
  if (a1 === 'D13') {
    let newValue = e.range.getValue();
    if (!newValue) return;
    newValue = newValue.toString().trim().toUpperCase();

    const matched = TAG_MAP[newValue];
    if (matched) {
      if (matched !== e.range.getValue()) e.range.setValue(matched);
      newValue = matched;
    } else {
      newValue = e.range.getValue().toString();
    }

    const dataSheet = getSheet_();
    const rows = getFilteredList_(dataSheet);
    const idx = cardSheet.getRange('G1').getValue();
    if (idx >= 1 && idx <= rows.length) {
      dataSheet.getRange(rows[idx - 1], COL.TAG).setValue(newValue);
      refreshCardText_(cardSheet, dataSheet, idx); // 同步刷新 B13 顯示
    }
    return;
  }
}

function goNextCard_(cardSheet) {
  const dataSheet = getSheet_();
  const rowsBefore = getFilteredList_(dataSheet);
  const idxCell = cardSheet.getRange('G1');
  let idx = idxCell.getValue() || 0;

  if (idx >= 1 && idx <= rowsBefore.length) {
    markDone_(dataSheet, rowsBefore[idx - 1]); // 離開前先標記目前這項完成
  }

  const rowsAfter = getFilteredList_(dataSheet);
  const total = rowsAfter.length;

  if (total === 0) {
    idxCell.setValue(0);
    refreshCardText_(cardSheet, dataSheet, 0);
    return;
  }

  // 目前這項離開清單後，原本排在它後面的項目會自然往前遞補到同一個位置，
  // 所以沿用同一個 idx 就等於自動前進到下一項；超出範圍就繞回開頭
  const newIdx = idx > total || idx < 1 ? 1 : idx;

  idxCell.setValue(newIdx);
  refreshCardText_(cardSheet, dataSheet, newIdx);
}

function goPrevCard_(cardSheet) {
  const dataSheet = getSheet_();
  const rows = getFilteredList_(dataSheet);
  const total = rows.length;
  const idxCell = cardSheet.getRange('G1');

  if (total === 0) {
    idxCell.setValue(0);
    refreshCardText_(cardSheet, dataSheet, 0);
    return;
  }

  let idx = idxCell.getValue() || 1;
  idx = idx - 1 < 1 ? total : idx - 1;
  idxCell.setValue(idx);
  refreshCardText_(cardSheet, dataSheet, idx);
}

/**
 * 刪除目前這項（B20觸發，經過確認對話框後才會呼叫）。
 * 直接從「表單回覆1」刪除該列，刪除後今日清單自然位移，沿用同一個 idx 就會對應到下一項。
 */
function deleteCurrentCardItem_(cardSheet) {
  const dataSheet = getSheet_();
  const rows = getFilteredList_(dataSheet);
  const idxCell = cardSheet.getRange('G1');
  const idx = idxCell.getValue() || 0;

  if (idx >= 1 && idx <= rows.length) {
    dataSheet.deleteRow(rows[idx - 1]);
  }

  const rowsAfter = getFilteredList_(dataSheet);
  const total = rowsAfter.length;

  if (total === 0) {
    idxCell.setValue(0);
    refreshCardText_(cardSheet, dataSheet, 0);
    return;
  }

  const newIdx = idx > total || idx < 1 ? 1 : idx;
  idxCell.setValue(newIdx);
  refreshCardText_(cardSheet, dataSheet, newIdx);
}

function refreshCardText_(cardSheet, dataSheet, idx) {
  const rows = getFilteredList_(dataSheet);

  // 每次刷新（翻頁）都清空輸入格，避免殘留舊值讓下次選同樣的值時 onEdit 判斷沒有變動而不觸發
  cardSheet.getRange('D6').setValue('');
  cardSheet.getRange('D13').setValue('');

  if (rows.length === 0) {
    cardSheet.getRange('B2').setValue('今天沒有待禱告的事項');
    cardSheet.getRange('B4').setValue('🎉 今天沒有需要禱告的事項');
    cardSheet.getRange('B6').setValue('目前週期：');
    cardSheet.getRange('B13').setValue('目前標籤：');
    return;
  }

  if (idx < 1) idx = 1;
  if (idx > rows.length) idx = ((idx - 1) % rows.length) + 1;

  const row = rows[idx - 1];
  const rowData = dataSheet.getRange(row, 1, 1, 8).getValues()[0];

  cardSheet.getRange('B2').setValue('第 ' + idx + ' 項 / 共 ' + rows.length + ' 項（今日待禱告）');
  cardSheet.getRange('B4').setValue(rowData[COL.TEXT - 1] || '');
  cardSheet.getRange('B6').setValue('目前週期：' + (rowData[COL.CYCLE - 1] || ''));
  cardSheet.getRange('B13').setValue('目前標籤：' + (rowData[COL.TAG - 1] || ''));
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🙏 禱告卡片')
    .addItem('🔊 開始連禱（自動朗讀＋跳下一項）', 'openReadAloudDialog')
    .addItem('📅 重新分配禱告日期（E欄）', 'assignPrayerDates')
    .addItem('📤 掃描並複製既有週幾標籤資料', 'exportExistingWeekdayTags')
    .addToUi();
}

/**
 * 補跑用：掃描整份「表單回覆1」，找出所有H欄已經是「週一」～「週日」但還沒被處理過的既有資料
 * （這些是功能上線之前就存在的舊資料，不會被onEdit自動偵測到，需要手動觸發一次）。
 * 符合的資料會複製到對應的 Google Tasks 清單，原始資料保留在表單回覆1不會被刪除。
 * 執行方式：選單「🙏 禱告卡片 → 📤 掃描並複製既有週幾標籤資料」
 */
function exportExistingWeekdayTags() {
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    safeAlert('沒有資料可以掃描。');
    return;
  }

  const numRows = lastRow - 1;
  const hValues = sheet.getRange(2, COL.TAG, numRows, 1).getValues();

  const matchedRows = [];
  for (let i = 0; i < hValues.length; i++) {
    const tagVal = (hValues[i][0] || '').toString().trim();
    if (WEEKDAY_TASK_LISTS[tagVal]) {
      matchedRows.push(i + 2);
    }
  }

  if (matchedRows.length === 0) {
    safeAlert('沒有找到任何符合「週一」～「週日」標籤的資料。');
    return;
  }

  let successCount = 0;
  let failCount = 0;
  matchedRows.forEach(row => {
    const exported = exportWeekdayTagIfMatched_(sheet, row);
    if (exported) {
      successCount++;
    } else {
      failCount++;
    }
  });

  const msg = '✅ 掃描完成！成功複製 ' + successCount + ' 筆到對應Tasks清單' +
    (failCount > 0 ? '，失敗 ' + failCount + ' 筆（詳情請看執行記錄）。' : '（原始資料皆保留在表單回覆1）。');
  safeAlert(msg);
}

/**
 * 提供給朗讀彈出視窗查詢目前狀態（透過 google.script.run 呼叫）。
 */
function dialogGetState() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cardSheet = ss.getSheetByName(CARD_SHEET_NAME);
  const dataSheet = getSheet_();
  const rows = getFilteredList_(dataSheet);
  const idx = cardSheet.getRange('G1').getValue() || 0;
  const text = cardSheet.getRange('B4').getValue().toString();
  return { text: text, index: idx, total: rows.length };
}

/**
 * 提供給朗讀彈出視窗使用：標記目前這項完成（同步更新表單回覆1的F、E欄），
 * 並依「今日待辦清單」前進到下一項，回傳新的狀態給前端繼續朗讀。
 */
function dialogAdvance() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cardSheet = ss.getSheetByName(CARD_SHEET_NAME);
  goNextCard_(cardSheet); // 內部已經處理：標記完成 → 前進 → 刷新 B2/B4/B6/B13
  return dialogGetState();
}

/**
 * 跳出一個小視窗，用瀏覽器內建語音朗讀（跟手機版同一種技術）連續朗讀。
 * 每項唸三次 → 標記完成 → 自動跳下一項 → 繼續，直到今日待辦清單唸完為止。
 * 因為 Google Sheets 本身沒有朗讀功能，必須透過 HtmlService 開一個實際的瀏覽器頁面來執行，
 * 並透過 google.script.run 跟 Apps Script 後端即時溝通（每唸完一項才請伺服器給下一項）。
 */
function openReadAloudDialog() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="UTF-8"></head>
    <body style="font-family: -apple-system, sans-serif; padding: 24px; text-align:center;">
      <div id="itemInfo" style="font-size:13px; color:#999;"></div>
      <div id="status" style="font-size:16px; color:#674ea7; font-weight:bold; margin-top:8px;">準備連禱中...</div>
      <div id="progress" style="margin-top:10px; font-size:14px; color:#666;"></div>
      <button id="stopBtn" style="margin-top:20px; padding:8px 20px; border-radius:8px; border:1px solid #674ea7; background:white; color:#674ea7; font-size:14px;">⏹ 停止連禱</button>
      <script>
        const REPEATS = 3;
        let voice = null;
        let stopped = false;

        document.getElementById('stopBtn').addEventListener('click', () => {
          stopped = true;
          if (window.speechSynthesis) window.speechSynthesis.cancel();
          document.getElementById('status').textContent = '已停止';
          setTimeout(() => google.script.host.close(), 500);
        });

        function pickVoice() {
          const voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
          voice = voices.find(v => v.lang === 'zh-TW')
               || voices.find(v => v.lang && v.lang.toLowerCase().startsWith('zh'))
               || null;
        }
        if (window.speechSynthesis) {
          pickVoice();
          window.speechSynthesis.onvoiceschanged = pickVoice;
        }

        function speakOnce(t) {
          return new Promise((resolve) => {
            if (!window.speechSynthesis || !t || !t.trim()) { resolve(); return; }
            const utter = new SpeechSynthesisUtterance(t);
            utter.lang = 'zh-TW';
            if (voice) utter.voice = voice;
            utter.rate = 0.95;
            utter.onend = resolve;
            utter.onerror = resolve;
            window.speechSynthesis.speak(utter);
          });
        }

        function callServer(fnName) {
          return new Promise((resolve, reject) => {
            google.script.run
              .withSuccessHandler(resolve)
              .withFailureHandler(reject)
              [fnName]();
          });
        }

        async function run() {
          let state = await callServer('dialogGetState');

          if (!state || state.total === 0) {
            document.getElementById('status').textContent = '🎉 今天沒有需要禱告的事項';
            setTimeout(() => google.script.host.close(), 1800);
            return;
          }

          while (!stopped) {
            document.getElementById('itemInfo').textContent = '第 ' + state.index + ' 項 / 共 ' + state.total + ' 項';

            for (let i = 0; i < REPEATS; i++) {
              if (stopped) return;
              document.getElementById('progress').textContent = '朗讀中（' + (i + 1) + ' / ' + REPEATS + ' 次）';
              await speakOnce(state.text);
            }
            if (stopped) return;

            document.getElementById('status').textContent = '標記完成，前進下一項...';
            state = await callServer('dialogAdvance');

            if (!state || state.total === 0) {
              document.getElementById('status').textContent = '🎉 今天的禱告事項都完成了';
              document.getElementById('progress').textContent = '';
              setTimeout(() => google.script.host.close(), 2000);
              return;
            }

            document.getElementById('status').textContent = '連禱中...';
          }
        }

        setTimeout(run, 300); // 稍微延遲，等瀏覽器語音清單載入
      </script>
    </body>
    </html>
  `;

  const output = HtmlService.createHtmlOutput(html).setWidth(340).setHeight(220);
  SpreadsheetApp.getUi().showModalDialog(output, '🔊 連禱中');
}

/**
 * 掃描 C 欄（DG 週期），只針對 E 欄「還沒有日期」的資料補上日期。
 * 已經有日期的列完全不動；同週期的計數會延續之前已排定的筆數繼續往下算。
 * 例如 3每三天：第1筆→今天、第2筆→明天、第3筆→後天、第4筆→繞回今天…以此類推。
 * 注意：這個函式掃描全部資料（不受今日待辦篩選影響），純粹是補日期用的。
 */
function assignPrayerDates() {
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    safeAlert('沒有資料可以分配。');
    return;
  }

  const numRows = lastRow - 1;
  const cycles = sheet.getRange(2, COL.CYCLE, numRows, 1).getValues();
  const existingDates = sheet.getRange(2, COL.DATE, numRows, 1).getValues();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const groupCounters = {};
  for (let i = 0; i < cycles.length; i++) {
    const cycle = (cycles[i][0] || '').toString().trim();
    const hasDate = existingDates[i][0] !== '' && existingDates[i][0] !== null;
    if (cycle && hasDate) {
      groupCounters[cycle] = (groupCounters[cycle] || 0) + 1;
    }
  }

  let filledCount = 0;
  const writes = [];

  for (let i = 0; i < cycles.length; i++) {
    const cycle = (cycles[i][0] || '').toString().trim();
    const hasDate = existingDates[i][0] !== '' && existingDates[i][0] !== null;

    if (!cycle || hasDate) continue;

    const period = CYCLE_PERIOD_DAYS[cycle] || 1;
    const idx = groupCounters[cycle] || 0;
    groupCounters[cycle] = idx + 1;

    const offset = idx % period;
    const date = new Date(today);
    date.setDate(date.getDate() + offset);

    writes.push({ row: i + 2, date: date });
    filledCount++;
  }

  writes.forEach(w => {
    const cell = sheet.getRange(w.row, COL.DATE);
    cell.setValue(w.date);
    cell.setNumberFormat('yyyy/MM/dd');
  });

  if (filledCount === 0) {
    safeAlert('沒有需要補日期的資料，E欄都已經有值了。');
  } else {
    safeAlert('✅ 已補上 ' + filledCount + ' 筆資料的禱告日期（E欄），原有日期未變動。');
  }
}

/**
 * 一次性設定函式：在「禱告卡片」分頁自動建立「刪除此項」的核取方塊按鈕（B20）。
 * 只需要執行一次：Apps Script編輯器上方函式下拉選單選 setupDeleteButton → 執行 ▶
 * 執行後 B20 會出現核取方塊，C20 會有紅色警示文字，不用手動在 Sheet 介面操作。
 */
function setupDeleteButton() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cardSheet = ss.getSheetByName(CARD_SHEET_NAME);
  if (!cardSheet) {
    safeAlert('找不到「禱告卡片」分頁，請確認分頁名稱是否一致。');
    return;
  }

  cardSheet.getRange('B20').insertCheckboxes();
  cardSheet.getRange('C20').setValue('🗑 刪除此項（不可復原）').setFontSize(13).setFontColor('#b0413e');
  cardSheet.getRange('B20:C20').setBackground('#fdeceb');
  cardSheet.setRowHeight(20, 32);

  safeAlert('✅ 已在 B20 建立刪除按鈕。平常操作時請留意，這個勾選框打勾後會跳出確認對話框，確認才會真的刪除資料。');
}

function safeAlert(msg) {
  try {
    SpreadsheetApp.getUi().alert(msg);
  } catch (err) {
    Logger.log(msg);
  }
}

function doGet(e) {
  // ?page=query → 直接由這個網頁應用程式服務查詢頁（query.html），
  // 不帶 page 參數時維持原本行為（JSON API，給 index.html／query.html 的 fetch 呼叫用）。
  if (e.parameter.page === 'query') {
    return HtmlService.createHtmlOutputFromFile('query')
      .setTitle('禱告卡片 - 查詢');
  }

  const action = (e.parameter.action || 'getAllItems');
  let result;
  try {
    switch (action) {
      case 'getAllItems':
        result = getAllItems();
        break;
      case 'completeByRow':
        result = completeByRow(parseInt(e.parameter.row, 10));
        break;
      case 'deleteByRow':
        result = deleteByRow(parseInt(e.parameter.row, 10));
        break;
      case 'updateTextByRow':
        result = updateFieldByRow(parseInt(e.parameter.row, 10), COL.TEXT, e.parameter.value);
        break;
      case 'updateCycleByRow':
        result = updateFieldByRow(parseInt(e.parameter.row, 10), COL.CYCLE, normalizeCode(e.parameter.value, CYCLE_MAP));
        break;
      case 'updateTagByRow':
        result = updateFieldByRow(parseInt(e.parameter.row, 10), COL.TAG, normalizeCode(e.parameter.value, TAG_MAP));
        break;
      case 'getTagList':
        result = getTagList();
        break;
      case 'addCustomTag':
        result = addCustomTag(e.parameter.value);
        break;
      case 'copyToTasks':
        result = copyCurrentRowToTasks(parseInt(e.parameter.row, 10));
        break;
      case 'getItemsByTag':
        result = getItemsByTag(e.parameter.tag);
        break;
      case 'searchItems':
        result = searchItems(e.parameter.keyword);
        break;
      case 'getTodayCalendarEvents':
        result = getTodayCalendarEvents();
        break;
      case 'updateCalendarEventCycle':
        result = updateCalendarEventCycle(e.parameter.eventId, e.parameter.recurringEventId, e.parameter.value);
        break;
      case 'deleteCalendarEvent':
        result = deleteCalendarEvent(e.parameter.eventId, e.parameter.recurringEventId);
        break;
      case 'updateCalendarEventTitle':
        result = updateCalendarEventTitle(e.parameter.eventId, e.parameter.recurringEventId, e.parameter.value);
        break;
      case 'getPrayerProgress':
        result = getPrayerProgress_();
        break;
      default:
        result = { error: 'unknown action: ' + action };
    }
  } catch (err) {
    result = { error: err.toString() };
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * 自訂標籤永久儲存在 PropertiesService（跟這份試算表綁定，不受手機瀏覽器資料清除或重新部署網頁影響，
 * 換裝置、換瀏覽器登入都能看到同一份清單）。
 */
const CUSTOM_TAGS_PROP_KEY = 'CUSTOM_TAGS';

function getCustomTags_() {
  const raw = PropertiesService.getDocumentProperties().getProperty(CUSTOM_TAGS_PROP_KEY);
  return raw ? JSON.parse(raw) : [];
}

function saveCustomTags_(tags) {
  PropertiesService.getDocumentProperties().setProperty(CUSTOM_TAGS_PROP_KEY, JSON.stringify(tags));
}

/**
 * 回傳完整標籤清單：內建（TAG_MAP）+ 自訂（永久儲存的）。
 */
function getTagList() {
  return { builtIn: Object.values(TAG_MAP), custom: getCustomTags_() };
}

/**
 * 新增一個自訂標籤並永久儲存（如果已存在，不重複加入），回傳更新後的完整清單。
 */
function addCustomTag(value) {
  if (!value) return getTagList();
  const trimmed = value.toString().trim();
  if (!trimmed) return getTagList();

  const tags = getCustomTags_();
  const builtIn = Object.values(TAG_MAP);
  if (!tags.includes(trimmed) && !builtIn.includes(trimmed)) {
    tags.push(trimmed);
    saveCustomTags_(tags);
  }
  return getTagList();
}

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('找不到分頁：' + SHEET_NAME);
  return sheet;
}

function normalizeCode(value, map) {
  if (!value) return value;
  const key = value.toString().trim().toUpperCase();
  return map[key] || value;
}

/**
 * 從 Google 帳號的預設日曆（primary），抓出「今天」的所有行程，
 * 每筆附上時間、備註（說明文字）跟依重複規則換算出來的週期文字（跟 CYCLE_MAP 顯示格式一致）。
 * 需要 appsscript.json 啟用 Calendar 進階服務（Advanced Calendar Service）才能讀到重複規則（RRULE）。
 */
function getTodayCalendarEvents() {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

  const resp = Calendar.Events.list('primary', {
    timeMin: startOfDay.toISOString(),
    timeMax: endOfDay.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 250
  });

  const items = (resp.items || []).map(function (ev) {
    const isAllDay = !!(ev.start && ev.start.date);
    return {
      id: ev.id,
      recurringEventId: ev.recurringEventId || '',
      text: ev.summary || '(無標題)',
      time: isAllDay ? '全天' : formatEventTime_(ev.start.dateTime),
      note: ev.description ? stripHtml_(ev.description) : '',
      cycle: getRecurrenceLabel_(ev)
    };
  });

  return { items: items, total: items.length };
}

function formatEventTime_(dateTimeStr) {
  return Utilities.formatDate(new Date(dateTimeStr), Session.getScriptTimeZone(), 'HH:mm');
}

function stripHtml_(html) {
  return html.toString().replace(/<[^>]*>/g, '').trim();
}

// 週期文字 → RRULE，跟 parseRRuleLabel_ 互為反向對照，維持顯示格式跟 CYCLE_MAP 一致
const CALENDAR_CYCLE_RRULE_MAP_ = {
  'D每天': 'RRULE:FREQ=DAILY',
  '2每兩天': 'RRULE:FREQ=DAILY;INTERVAL=2',
  '3每三天': 'RRULE:FREQ=DAILY;INTERVAL=3',
  'W每週': 'RRULE:FREQ=WEEKLY',
  'DW每兩週': 'RRULE:FREQ=WEEKLY;INTERVAL=2',
  'M每月': 'RRULE:FREQ=MONTHLY',
  '2M每兩個月': 'RRULE:FREQ=MONTHLY;INTERVAL=2',
  'S每季': 'RRULE:FREQ=MONTHLY;INTERVAL=3',
  'HY每半年': 'RRULE:FREQ=MONTHLY;INTERVAL=6',
  'Y每年': 'RRULE:FREQ=YEARLY'
};

/**
 * 修改一個日曆行程的重複規則。如果原本就是重複行程（有 recurringEventId），
 * 改的是整個系列（用 recurringEventId 對應的主行程）；如果原本是單次行程，
 * 直接在這個行程本身加上重複規則（等於把它變成一個新的重複系列）。
 * cycleLabel 給「不重複」或空值時，會移除重複規則。
 */
function updateCalendarEventCycle(eventId, recurringEventId, cycleLabel) {
  const targetId = recurringEventId || eventId;
  if (!targetId) throw new Error('缺少行程 ID');

  const rrule = cycleLabelToRRule_(cycleLabel);
  Calendar.Events.patch({ recurrence: rrule ? [rrule] : [] }, 'primary', targetId);
  return { success: true };
}

// 中文星期文字 → RRULE 的 BYDAY 代碼，跟 getByDaySuffix_ 的 dayLabel 互為反向對照
const DAY_LABEL_TO_CODE_ = { 一: 'MO', 二: 'TU', 三: 'WE', 四: 'TH', 五: 'FR', 六: 'SA', 日: 'SU' };

/**
 * 把週期文字換算成 RRULE，支援「W每週（平日）」「W每週（週末）」「W每週（三）」這種
 * 帶星期限定的週期文字（跟 parseRRuleLabel_／getByDaySuffix_ 的顯示格式對稱）。
 */
function cycleLabelToRRule_(cycleLabel) {
  if (!cycleLabel || cycleLabel === '不重複') return '';

  const match = cycleLabel.match(/^(.*?)（(.+)）$/);
  const baseLabel = match ? match[1] : cycleLabel;
  const daySuffix = match ? match[2] : '';

  const baseRRule = CALENDAR_CYCLE_RRULE_MAP_[baseLabel];
  if (!baseRRule || !daySuffix) return baseRRule || '';

  let byDayCodes;
  if (daySuffix === '平日') {
    byDayCodes = ['MO', 'TU', 'WE', 'TH', 'FR'];
  } else if (daySuffix === '週末') {
    byDayCodes = ['SA', 'SU'];
  } else {
    byDayCodes = daySuffix.split('、').map(function (d) { return DAY_LABEL_TO_CODE_[d]; }).filter(Boolean);
  }

  return byDayCodes.length ? (baseRRule + ';BYDAY=' + byDayCodes.join(',')) : baseRRule;
}

/**
 * 修改一個日曆行程的標題。如果是重複行程，改的是整個系列（用 recurringEventId 對應的
 * 主行程），所有次的標題都會一起更新；不是重複行程的話，就只改這一筆本身。
 */
function updateCalendarEventTitle(eventId, recurringEventId, value) {
  const targetId = recurringEventId || eventId;
  if (!targetId) throw new Error('缺少行程 ID');
  Calendar.Events.patch({ summary: value }, 'primary', targetId);
  return { success: true };
}

/**
 * 刪除一個日曆行程。如果是重複行程，會用 recurringEventId 刪除整個系列；
 * 不是重複行程的話，就只刪除這一筆。
 */
function deleteCalendarEvent(eventId, recurringEventId) {
  const targetId = recurringEventId || eventId;
  if (!targetId) throw new Error('缺少行程 ID');

  Calendar.Events.remove('primary', targetId);
  return { success: true };
}

// 同一個重複行程系列，今天可能出現不只一筆（理論上不會，但保險起見快取，避免重複打 API）
const RECURRENCE_MASTER_CACHE_ = {};

function getRecurrenceLabel_(ev) {
  if (!ev.recurringEventId) return '不重複';

  let master = RECURRENCE_MASTER_CACHE_[ev.recurringEventId];
  if (!master) {
    try {
      master = Calendar.Events.get('primary', ev.recurringEventId);
      RECURRENCE_MASTER_CACHE_[ev.recurringEventId] = master;
    } catch (err) {
      return '重複（無法讀取規則）';
    }
  }

  const rrule = (master.recurrence || []).filter(function (r) { return r.indexOf('RRULE:') === 0; })[0];
  return rrule ? parseRRuleLabel_(rrule) : '重複';
}

/**
 * 把 RRULE 換算成跟 CYCLE_MAP 顯示格式一致的週期文字，方便跟禱告卡片的週期樣式對齊；
 * 沒有對應到既有週期選項的，就直接顯示還原後的規則文字。
 */
function parseRRuleLabel_(rrule) {
  const freqMatch = rrule.match(/FREQ=([A-Z]+)/);
  const intervalMatch = rrule.match(/INTERVAL=(\d+)/);
  const freq = freqMatch ? freqMatch[1] : '';
  const interval = intervalMatch ? parseInt(intervalMatch[1], 10) : 1;

  if (freq === 'DAILY') {
    if (interval === 1) return 'D每天';
    if (interval === 2) return '2每兩天';
    if (interval === 3) return '3每三天';
    return '每' + interval + '天';
  }
  if (freq === 'WEEKLY') {
    const suffix = getByDaySuffix_(rrule);
    if (interval === 1) return 'W每週' + suffix;
    if (interval === 2) return 'DW每兩週' + suffix;
    return '每' + interval + '週' + suffix;
  }
  if (freq === 'MONTHLY') {
    if (interval === 1) return 'M每月';
    if (interval === 2) return '2M每兩個月';
    if (interval === 3) return 'S每季';
    if (interval === 6) return 'HY每半年';
    return '每' + interval + '個月';
  }
  if (freq === 'YEARLY') return 'Y每年';

  return '重複（' + rrule.replace('RRULE:', '') + '）';
}

/**
 * 把 RRULE 裡的 BYDAY（星期幾限定）換算成附加說明文字，例如「（平日）」「（週末）」「（三、五）」，
 * 只用來讓週期文字更準確，沒有 BYDAY 就回傳空字串（維持跟原本一樣的顯示）。
 */
function getByDaySuffix_(rrule) {
  const match = rrule.match(/BYDAY=([A-Z,]+)/);
  if (!match) return '';

  const days = match[1].split(',');
  const dayLabel = { MO: '一', TU: '二', WE: '三', TH: '四', FR: '五', SA: '六', SU: '日' };
  const weekdayOrder = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
  const isWeekday = days.length === 5 && ['MO', 'TU', 'WE', 'TH', 'FR'].every(function (d) { return days.indexOf(d) !== -1; });
  const isWeekend = days.length === 2 && ['SA', 'SU'].every(function (d) { return days.indexOf(d) !== -1; });

  if (isWeekday) return '（平日）';
  if (isWeekend) return '（週末）';

  const sorted = days.slice().sort(function (a, b) { return weekdayOrder.indexOf(a) - weekdayOrder.indexOf(b); });
  return '（' + sorted.map(function (d) { return dayLabel[d] || d; }).join('、') + '）';
}

/**
 * 一次把「今天待禱告清單」全部抓出來（一次 getValues，不逐列讀取），
 * 每筆資料附上實際的工作表列號（row），前端存成本地暫存區，
 * 之後翻頁、隨機、跳項都直接用本地資料，不用再打 API。
 */
function getAllItems() {
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { items: [], total: 0 };

  const numRows = lastRow - 1;
  const allData = sheet.getRange(2, 1, numRows, 8).getValues();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const items = [];
  for (let i = 0; i < allData.length; i++) {
    const dateVal = allData[i][COL.DATE - 1];
    let include = false;

    if (dateVal === '' || dateVal === null || dateVal === undefined) {
      include = true;
    } else if (dateVal instanceof Date && !isNaN(dateVal.getTime())) {
      const d = new Date(dateVal);
      d.setHours(0, 0, 0, 0);
      if (d.getTime() <= today.getTime()) include = true;
    }

    if (include) {
      items.push({
        row: i + 2, // 實際工作表列號，前端用這個定位，不受清單重新排序影響
        text: allData[i][COL.TEXT - 1] || '',
        cycle: allData[i][COL.CYCLE - 1] || '',
        note: allData[i][COL.NOTE - 1] || '',
        tag: allData[i][COL.TAG - 1] || ''
      });
    }
  }

  return { items: items, total: items.length };
}

/**
 * 查詢頁面用：掃描「表單回覆1」全部資料（不受今日待辦日期篩選影響），
 * 回傳標籤（H欄）完全等於指定值的所有項目，依 E 欄「本次禱告時間」由舊到新排序
 * （E欄空白視為最早，排在最前面，代表還沒排定日期、最需要優先處理）。
 */
function getItemsByTag(tag) {
  const trimmedTag = (tag || '').toString().trim();
  if (!trimmedTag) return { items: [] };

  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { items: [] };

  const numRows = lastRow - 1;
  const allData = sheet.getRange(2, 1, numRows, 8).getValues();

  const items = [];
  for (let i = 0; i < allData.length; i++) {
    const rowTag = (allData[i][COL.TAG - 1] || '').toString().trim();
    if (rowTag !== trimmedTag) continue;

    const dateVal = allData[i][COL.DATE - 1];
    const isValidDate = dateVal instanceof Date && !isNaN(dateVal.getTime());

    items.push({
      row: i + 2,
      text: allData[i][COL.TEXT - 1] || '',
      cycle: allData[i][COL.CYCLE - 1] || '',
      note: allData[i][COL.NOTE - 1] || '',
      tag: allData[i][COL.TAG - 1] || '',
      dateSortKey: isValidDate ? dateVal.getTime() : -1 // 空白日期排最前面
    });
  }

  items.sort((a, b) => a.dateSortKey - b.dateSortKey);
  items.forEach(it => { delete it.dateSortKey; });

  return { items: items };
}

/**
 * 查詢頁面用：掃描「表單回覆1」全部資料（不受今日待辦日期篩選影響），
 * 回傳事項文字（B欄）包含指定關鍵字的所有項目（不分大小寫）。
 */
function searchItems(keyword) {
  const trimmedKeyword = (keyword || '').toString().trim().toLowerCase();
  if (!trimmedKeyword) return { items: [] };

  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { items: [] };

  const numRows = lastRow - 1;
  const allData = sheet.getRange(2, 1, numRows, 8).getValues();

  const items = [];
  for (let i = 0; i < allData.length; i++) {
    const text = (allData[i][COL.TEXT - 1] || '').toString();
    if (text.toLowerCase().indexOf(trimmedKeyword) === -1) continue;
    items.push({
      row: i + 2,
      text: text,
      cycle: allData[i][COL.CYCLE - 1] || '',
      note: allData[i][COL.NOTE - 1] || '',
      tag: allData[i][COL.TAG - 1] || ''
    });
  }

  return { items: items };
}

/**
 * 用實際列號標記完成（F欄打Y→推進E欄→清空F欄）。
 * 不需要重新掃描今日清單，前端可以背景呼叫，不阻塞畫面。
 */
function completeByRow(row) {
  if (!row || row < 2) return { success: false };
  markDone_(getSheet_(), row);
  return { success: true, row: row };
}

/**
 * 用實際列號刪除該列資料。刪除後，該列以下所有列號會往前移一位，
 * 前端收到成功回應後，會自動校正本地暫存區裡所有列號 > 這個 row 的項目（各減1）。
 */
function deleteByRow(row) {
  if (!row || row < 2) return { success: false };
  getSheet_().deleteRow(row);
  return { success: true, deletedRow: row };
}

/**
 * 用實際列號更新指定欄位（事項文字／週期／標籤）。
 */
function updateFieldByRow(row, col, value) {
  if (!row || row < 2) return { success: false };
  const sheet = getSheet_();
  sheet.getRange(row, col).setValue(value);

  // 如果是標籤欄位，檢查是否需要複製到 Google Tasks（兩種情況都只複製，不會刪除這一列）
  if (col === COL.TAG) {
    // 週幾標籤 → 複製到對應的週幾清單
    const exported = exportWeekdayTagIfMatched_(sheet, row);
    if (exported) {
      return { success: true, row: row, exported: true };
    }

    // task預設清單標籤 → 複製到Tasks預設清單（只在「切換成」這個值那一刻觸發一次）
    const copied = copyToDefaultTaskListIfTagged_(sheet, row);
    if (copied) {
      return { success: true, row: row, copied: true };
    }
  }

  return { success: true, row: row };
}

function importGoogleTasksToday_() {
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  const IMPORT_TAG = 'task預設清單';

  // 建立「事項名稱→列號」對照表，用來判斷是否已存在
  const existingMap = {};
  if (lastRow >= 2) {
    const textValues = sheet.getRange(2, COL.TEXT, lastRow - 1, 1).getValues();
    textValues.forEach((row, i) => {
      const name = (row[0] || '').toString().trim();
      if (name) existingMap[name] = i + 2;
    });
  }

  const taskLists = Tasks.Tasklists.list({ maxResults: 1 });
  if (!taskLists.items || taskLists.items.length === 0) {
    console.log('找不到任何 Google Tasks 清單。');
    return;
  }
  const defaultListId = taskLists.items[0].id;
  const tasksResult = Tasks.Tasks.list(defaultListId, { showCompleted: false, maxResults: 100 });
  const tasks = tasksResult.items || [];

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let updatedCount = 0, addedCount = 0;

  tasks.forEach(task => {
    const title = (task.title || '').trim();
    if (!title) return;

    if (existingMap[title]) {
      const row = existingMap[title];
      const dateCell = sheet.getRange(row, COL.DATE);
      dateCell.setValue(today);
      dateCell.setNumberFormat('yyyy/MM/dd');

      // 只有H欄原本是空白時才補標籤，已經有其他標籤的話維持原樣不覆蓋
      const tagCell = sheet.getRange(row, COL.TAG);
      const existingTag = (tagCell.getValue() || '').toString().trim();
      if (!existingTag) {
        tagCell.setValue(IMPORT_TAG);
      }

      updatedCount++;
    } else {
      const newRow = sheet.getLastRow() + 1;
      sheet.getRange(newRow, COL.TEXT).setValue(title);
      sheet.getRange(newRow, COL.NOTE).setValue(task.notes || '');
      const dateCell = sheet.getRange(newRow, COL.DATE);
      dateCell.setValue(today);
      dateCell.setNumberFormat('yyyy/MM/dd');
      sheet.getRange(newRow, COL.TAG).setValue(IMPORT_TAG);   // 新增列一定是空白，直接打標籤
      existingMap[title] = newRow;
      addedCount++;
    }
  });

  console.log(`✅ Google Tasks 匯入完成：更新 ${updatedCount} 筆、新增 ${addedCount} 筆。`);
}

/**
 * 手動執行一次：建立每天 05:00 自動執行 importGoogleTasksToday_ 的時間觸發器
 */
function setupTasksImportTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'importGoogleTasksToday_') {
      ScriptApp.deleteTrigger(t);
    }
  });

  ScriptApp.newTrigger('importGoogleTasksToday_')
    .timeBased()
    .everyDays(1)
    .atHour(5)
    .create();

  console.log('✅ 每天05:00匯入Google Tasks的觸發器已建立完成！');
}

function testImportGoogleTasksNow() {
  importGoogleTasksToday_();
}

/**
 * 自動合併「表單回覆1」裡B欄事項文字重複的列。
 * 判定重複的規則：文字完全相同，或其中一筆是另一筆的子字串（例如在禱告卡片中途對同一項目
 * 增加了字詞，新文字會包含舊文字），都視為同一組——不再要求文字必須100%一模一樣。
 * 合併規則：把組內所有不同版本的文字整合起來（換行分隔），不會漏掉任何一筆的內容，其餘列刪除。
 * - B欄文字：組內每個版本都保留（已經被其他版本完整包含的子字串不重複列出），換行合併
 * - C欄週期：取合併範圍內天數最長的週期
 * - E欄日期：取合併範圍內最晚的日期
 * - D欄備註：所有不同備註合併（換行分隔，重複內容不疊加）
 * - H欄標籤：取第一個非空的標籤
 * 這支是觸發器安全版本（不呼叫UI alert，只寫Log），可搭配每日自動觸發器使用，
 * 也可以手動執行測試（執行完會嘗試跳alert，如果沒有UI環境會自動改寫Log，不會報錯）。
 */
function autoMergeDuplicateItems() {
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const numRows = lastRow - 1;
  const allData = sheet.getRange(2, 1, numRows, 8).getValues();

  // 依B欄文字分組：文字相同，或其中一筆是另一筆的子字串，都歸為同一組
  const groups = []; // [{ texts: [...], rows: [...] }, ...]
  allData.forEach((row, i) => {
    const text = (row[COL.TEXT - 1] || '').toString().trim();
    if (!text) return;

    const matched = groups.find(g => g.texts.some(t => t.includes(text) || text.includes(t)));
    if (matched) {
      matched.texts.push(text);
      matched.rows.push(i + 2);
    } else {
      groups.push({ texts: [text], rows: [i + 2] });
    }
  });

  const duplicateGroups = groups.filter(g => g.rows.length > 1);
  if (duplicateGroups.length === 0) {
    console.log('沒有找到重複事項，無需合併。');
    return;
  }

  let mergedGroupCount = 0;
  const rowsToDelete = [];

  duplicateGroups.forEach(({ texts, rows }) => {
    // 把組內所有不重複的文字整合起來：已經被其他版本完整包含的子字串不重複列出，
    // 避免「舊文字」跟「舊文字+新增內容」的新版本同時出現、內容互相包含卻重複顯示
    const uniqueTexts = [...new Set(texts)];
    const maximalTexts = uniqueTexts.filter(t => !uniqueTexts.some(other => other !== t && other.includes(t)));
    const targetText = maximalTexts.join('\n');

    // 主列固定選組內文字最長的那一列，當作其他欄位（週期/日期/標籤）合併結果要寫回的位置
    let targetRow = rows[0];
    let longestLen = texts[0].length;
    rows.forEach((r, idx) => {
      if (texts[idx].length > longestLen) {
        longestLen = texts[idx].length;
        targetRow = r;
      }
    });
    const otherRows = rows.filter(r => r !== targetRow); // 其餘的合併後刪除

    sheet.getRange(targetRow, COL.TEXT).setValue(targetText);

    let bestCycle = '';
    let bestCyclePeriod = -1;
    let bestDate = null;
    const notesSet = [];
    let mergedTag = '';

    rows.forEach(r => {
      const rowData = sheet.getRange(r, 1, 1, 8).getValues()[0];

      const cycle = (rowData[COL.CYCLE - 1] || '').toString().trim();
      const period = CYCLE_PERIOD_DAYS[cycle] || 0;
      if (cycle && period > bestCyclePeriod) {
        bestCyclePeriod = period;
        bestCycle = cycle;
      }

      const dateVal = rowData[COL.DATE - 1];
      if (dateVal instanceof Date && !isNaN(dateVal.getTime())) {
        if (!bestDate || dateVal.getTime() > bestDate.getTime()) {
          bestDate = dateVal;
        }
      }

      const note = (rowData[COL.NOTE - 1] || '').toString().trim();
      if (note && !notesSet.includes(note)) {
        notesSet.push(note);
      }

      const tag = (rowData[COL.TAG - 1] || '').toString().trim();
      if (tag && !mergedTag) {
        mergedTag = tag;
      }
    });

    if (bestCycle) sheet.getRange(targetRow, COL.CYCLE).setValue(bestCycle);
    if (bestDate) {
      const dateCell = sheet.getRange(targetRow, COL.DATE);
      dateCell.setValue(bestDate);
      dateCell.setNumberFormat('yyyy/MM/dd');
    }
    if (notesSet.length > 0) {
      sheet.getRange(targetRow, COL.NOTE).setValue(notesSet.join('\n'));
    }
    if (mergedTag) sheet.getRange(targetRow, COL.TAG).setValue(mergedTag);

    otherRows.forEach(r => rowsToDelete.push(r));
    mergedGroupCount++;
  });

  // 由大到小刪除，避免刪除較上面的列時，讓還沒處理的列號跟著位移錯亂
  rowsToDelete.sort((a, b) => b - a);
  rowsToDelete.forEach(r => sheet.deleteRow(r));

  const msg = `✅ 自動合併完成：合併了 ${mergedGroupCount} 組重複事項，共刪除 ${rowsToDelete.length} 列多餘資料。`;
  console.log(msg);
  safeAlert(msg); // 手動執行時會跳alert；觸發器自動執行時safeAlert內部會自動改寫Log，不會報錯
}

/**
 * 手動執行一次：建立每天清晨3:00自動執行 autoMergeDuplicateItems 的時間觸發器
 */
function setupDailyMergeTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'autoMergeDuplicateItems') {
      ScriptApp.deleteTrigger(t);
    }
  });

  ScriptApp.newTrigger('autoMergeDuplicateItems')
    .timeBased()
    .everyDays(1)
    .atHour(3)
    .create();

  console.log('✅ 每天3:00～4:00自動合併重複事項的觸發器已建立完成！');
}

/**
 * 手動執行一次：建立每週六、週日 05:00 自動執行 importGoogleTasksToday_ 的時間觸發器
 * （取代原本的「每天」觸發器，改成只在週末執行）
 */
function setupTasksImportTrigger() {
  // 先清掉舊的同名觸發器（不管原本是每天還是每週的版本，都先清乾淨再重建，避免重複觸發）
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'importGoogleTasksToday_') {
      ScriptApp.deleteTrigger(t);
    }
  });

  ScriptApp.newTrigger('importGoogleTasksToday_')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.SATURDAY)
    .atHour(5)
    .create();

  ScriptApp.newTrigger('importGoogleTasksToday_')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.SUNDAY)
    .atHour(5)
    .create();

  console.log('✅ 每週六、週日05:00匯入Google Tasks的觸發器已建立完成！');
}
