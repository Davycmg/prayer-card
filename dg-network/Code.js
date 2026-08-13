/**
 * 代禱表單 + 代禱卡片 - 整合版（單一部署網址）
 *
 * 網址用法：
 *   .../exec                → 代禱表單（輸入姓名自動帶出舊資料編輯）
 *   .../exec?view=card      → 代禱卡片網頁（今日待代禱名單，可翻頁、朗讀）
 *   .../exec?action=xxx     → 代禱卡片專用的資料 API（前端 fetch 用，不用手動打開）
 *
 * 部署方式：
 * 1. 打開試算表 → 擴充功能 > Apps Script
 * 2. 把這個檔案內容貼進 Code.gs
 * 3. 新增 HTML 檔案「Form」，貼上 Form.html 內容
 * 4. 新增 HTML 檔案「CardIndex」，貼上 CardIndex.html 內容
 * 5. 部署 > 新增部署作業 > 網頁應用程式（執行身分：我／存取權視需求）
 */

const SHEET_NAME = '表單回覆 1'; // 你的分頁名稱，如不同請修改
const CARD_SHEET_NAME = '代禱卡片'; // Google Sheet 內操作用的卡片分頁（選用）

const COLUMNS = {
  timestamp: 1,   // A 時間戳記
  name: 2,        // B 姓名
  cycle: 3,       // C DG 週期
  note: 4,        // D 備註
  email: 5,       // E 電子郵件地址（表單連動欄位，無法刪除）
  thisPrayer: 6,  // F 本次代禱
  nextPrayer: 7   // G 下次代禱
};

// 代禱卡片沿用同一組欄位（用別名方便閱讀，數字都指向 COLUMNS，避免兩邊寫死數字不同步）
const COL = {
  NAME: COLUMNS.name,
  CYCLE: COLUMNS.cycle,
  NOTE: COLUMNS.note,
  THIS: COLUMNS.thisPrayer,
  NEXT: COLUMNS.nextPrayer
};

// 代禱卡片工作表（Google Sheet 內操作）快速輸入用的簡碼對照
const CYCLE_MAP = {
  'D': '每天', '2': '每兩天', '3': '每三天', '4': '每四天', '5': '每五天', 'W': '每週', 'DW': '每兩週',
  'M': '每月', '2M': '每兩個月', 'S': '每季', 'HY': '每半年', 'Y': '每年'
};

function getSheet_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) {
    throw new Error('找不到分頁：' + SHEET_NAME + '，請確認分頁名稱是否正確');
  }
  return sheet;
}

/**
 * 依週期計算下一次代禱日期（代禱表單、代禱卡片共用同一套邏輯，確保兩邊算法一致）
 */
function computeNextDate_(baseDate, cycle) {
  const d = new Date(baseDate);
  switch (cycle) {
    case '每天': d.setDate(d.getDate() + 1); break;
    case '每兩天': d.setDate(d.getDate() + 2); break;
    case '每三天': d.setDate(d.getDate() + 3); break;
    case '每四天': d.setDate(d.getDate() + 4); break;
    case '每五天': d.setDate(d.getDate() + 5); break;
    case '每週': d.setDate(d.getDate() + 7); break;
    case '每兩週': d.setDate(d.getDate() + 14); break;
    case '每月': d.setMonth(d.getMonth() + 1); break;
    case '每兩個月': d.setMonth(d.getMonth() + 2); break;
    case '每季':
    case '每季（每三個月）':
    case '每季(每三個月)':
      d.setMonth(d.getMonth() + 3);
      break;
    case '每半年': d.setMonth(d.getMonth() + 6); break;
    case '每年': d.setFullYear(d.getFullYear() + 1); break;
    default: d.setMonth(d.getMonth() + 1);
  }
  return d;
}

// ========== 網頁 / API 總入口 ==========

function doGet(e) {
  const action = e.parameter.action;
  const view = e.parameter.view;

  // 帶 action 參數 → 代禱卡片專用的資料 API（回傳 JSON）
  if (action) {
    return handleCardApi_(e, action);
  }

  // view=card → 代禱卡片網頁
  if (view === 'card') {
    const tmpl = HtmlService.createTemplateFromFile('CardIndex');
    tmpl.apiUrl = ScriptApp.getService().getUrl();
    return tmpl.evaluate()
      .setTitle('代禱卡片')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }

  // view=card-fixed → 代禱卡片網頁（固定名單版，只顯示 FIXED_ROSTER_NAMES 那幾位，依指定順序）
  if (view === 'card-fixed') {
    const tmpl = HtmlService.createTemplateFromFile('CardIndexFixed');
    tmpl.apiUrl = ScriptApp.getService().getUrl();
    return tmpl.evaluate()
      .setTitle('代禱卡片（固定名單）')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }

  // form=simple → 代禱表單（不顯示 DG 週期欄位的簡化版，跟 Form.html 其他部分一樣）
  if (e.parameter.form === 'simple') {
    return HtmlService.createHtmlOutputFromFile('FormNoCycle')
      .setTitle('代禱表單')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }

  // form=fixed → 中午RPG（固定名單版，一次列出 FIXED_ROSTER_NAMES 那幾位，不顯示 DG 週期欄位，
  // 每人各自姓名+備註，統一「全部送出」）
  if (e.parameter.form === 'fixed') {
    return HtmlService.createHtmlOutputFromFile('中午RPG')
      .setTitle('中午RPG')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }

  // form=fixed2 → 代禱表單（另一組固定名單：吳安祺、郭大衛），跟 form=fixed（中午RPG）同一份程式邏輯，
  // 只是換一份名單的獨立副本（FormFixedRoster2.html）
  if (e.parameter.form === 'fixed2') {
    return HtmlService.createHtmlOutputFromFile('FormFixedRoster2')
      .setTitle('代禱表單（固定名單 2）')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }

  // form=fixed3 → 中午RPG2（中午RPG 的副本，換一份固定名單：黃姿驊、郭大衛、楊采綸）
  if (e.parameter.form === 'fixed3') {
    return HtmlService.createHtmlOutputFromFile('中午RPG2')
      .setTitle('中午RPG2')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }

  // form=fixed4 → 中午RPG3（中午RPG 的副本，換一份固定名單：郭大衛、顏志龍）
  if (e.parameter.form === 'fixed4') {
    return HtmlService.createHtmlOutputFromFile('中午RPG3')
      .setTitle('中午RPG3')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }

  // 預設 → 代禱表單
  return HtmlService.createTemplateFromFile('Form')
    .evaluate()
    .setTitle('代禱表單')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ========== 代禱表單：查詢 / 送出 ==========

/**
 * 依姓名查詢是否已有舊資料（找出「所有」符合的列，供合併用）
 * @param {string} name
 * @return {Object|null} { rows: number[], rowCycles: string[], cycles: string[], note: string, email: string }
 */
function lookupByName(name) {
  name = (name || '').trim();
  if (!name) return null;

  const sheet = getSheet_();
  const data = sheet.getDataRange().getValues();

  const matchedRows = [];
  const rowCycles = [];
  const notes = [];
  const cycles = [];
  let email = '';

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (String(row[COLUMNS.name - 1]).trim() === name) {
      const rowIndex = i + 1;
      matchedRows.push(rowIndex);

      const cycle = String(row[COLUMNS.cycle - 1] || '').trim();
      rowCycles.push(cycle || '(未設定)');
      if (cycle && cycles.indexOf(cycle) === -1) cycles.push(cycle);

      const note = String(row[COLUMNS.note - 1] || '').trim();
      if (note && notes.indexOf(note) === -1) notes.push(note);

      const rowEmail = String(row[COLUMNS.email - 1] || '').trim();
      if (rowEmail) email = rowEmail;
    }
  }

  if (matchedRows.length === 0) return null;

  return {
    rows: matchedRows,
    rowCycles: rowCycles,
    cycles: cycles,
    note: notes.join('\n'),
    email: email
  };
}

/**
 * 新增或更新一筆資料
 */
function submitForm(formData) {
  const sheet = getSheet_();
  const name = (formData.name || '').trim();
  const cycle = formData.cycle || '';
  const note = formData.note || '';
  const email = formData.email || '';
  const rows = Array.isArray(formData.rows) ? formData.rows.slice() : [];

  if (!name) throw new Error('姓名為必填欄位');
  if (!cycle) throw new Error('請選擇 DG 週期');

  const now = new Date();
  const nextDate = computeNextDate_(now, cycle);

  if (rows.length > 0) {
    rows.sort(function (a, b) { return a - b; });
    const keepRow = rows[0];
    const deleteRows = rows.slice(1);

    deleteRows.sort(function (a, b) { return b - a; });
    deleteRows.forEach(function (r) { sheet.deleteRow(r); });

    sheet.getRange(keepRow, COLUMNS.timestamp).setValue(now);
    sheet.getRange(keepRow, COLUMNS.cycle).setValue(cycle);
    sheet.getRange(keepRow, COLUMNS.note).setValue(note);
    if (email) sheet.getRange(keepRow, COLUMNS.email).setValue(email);
    sheet.getRange(keepRow, COLUMNS.thisPrayer).setValue(now);
    sheet.getRange(keepRow, COLUMNS.nextPrayer).setValue(nextDate);

    return { status: 'updated', row: keepRow, mergedCount: rows.length };
  } else {
    sheet.appendRow([now, name, cycle, note, email, now, nextDate]);
    return { status: 'created' };
  }
}

/**
 * 批次查詢多個姓名是否已有舊資料，給多人輸入表單即時顯示狀態用。
 */
function lookupByNames(names) {
  return (names || []).map(function (rawName) {
    const name = (rawName || '').trim();
    if (!name) return { name: name, existing: null };
    return { name: name, existing: lookupByName(name) };
  });
}

/**
 * 一次輸入多人（用半形逗點分隔），週期一致。
 * 已經有舊資料的人（lookupByName 查得到）完全不動，只新增查無資料的人。
 */
function submitFormMulti(formData) {
  const sheet = getSheet_();
  const cycle = formData.cycle || '';
  const note = formData.note || '';
  const email = formData.email || '';
  const names = Array.isArray(formData.names) ? formData.names : [];

  if (!cycle) throw new Error('請選擇 DG 週期');

  const now = new Date();
  const nextDate = computeNextDate_(now, cycle);

  const created = [];
  const skipped = [];
  const seen = [];

  names.forEach(function (rawName) {
    const name = (rawName || '').trim();
    if (!name || seen.indexOf(name) !== -1) return;
    seen.push(name);

    const existing = lookupByName(name);
    if (existing) {
      skipped.push(name);
      return;
    }

    sheet.appendRow([now, name, cycle, note, email, now, nextDate]);
    created.push(name);
  });

  return { created: created, skipped: skipped };
}

// ========== 代禱卡片：共用邏輯（網頁版API + Google Sheet版都會用到） ==========

/**
 * 掃描「表單回覆 1」，回傳「G欄（下次代禱）是空白，或日期 <= 今天」的實際列號清單。
 */
function getFilteredList_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const numRows = lastRow - 1;
  const nextDates = sheet.getRange(2, COL.NEXT, numRows, 1).getValues();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const rows = [];
  for (let i = 0; i < nextDates.length; i++) {
    const val = nextDates[i][0];
    if (val === '' || val === null || val === undefined) {
      rows.push(i + 2);
      continue;
    }
    if (val instanceof Date && !isNaN(val.getTime())) {
      const d = new Date(val);
      d.setHours(0, 0, 0, 0);
      if (d.getTime() <= today.getTime()) rows.push(i + 2);
    }
  }
  return rows;
}

/**
 * 標記某一列「這次代禱完成」：F 欄寫入現在時間、G 欄依週期往後推進（若仍 <= 今天則持續推進）。
 */
function markDone_(sheet, row) {
  const cycle = sheet.getRange(row, COL.CYCLE).getValue().toString().trim();
  const now = new Date();

  let base = sheet.getRange(row, COL.NEXT).getValue();
  if (!(base instanceof Date) || isNaN(base.getTime())) base = now;

  let next = computeNextDate_(base, cycle);
  let guard = 0;
  while (next <= now && guard < 500) {
    next = computeNextDate_(next, cycle);
    guard++;
  }

  sheet.getRange(row, COL.THIS).setValue(now);
  sheet.getRange(row, COL.THIS).setNumberFormat('yyyy/MM/dd HH:mm:ss');
  sheet.getRange(row, COL.NEXT).setValue(next);
  sheet.getRange(row, COL.NEXT).setNumberFormat('yyyy/MM/dd HH:mm:ss');
  recordPrayerCompleted_();
}

// 今日完成計數器：存在 PropertiesService（跟這份試算表綁定），日期不是今天就視同歸零重算
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
 * 今日代禱完成率：已完成數（今天累計標記完成的次數）÷（已完成數 + 目前還待代禱的項目數）。
 */
function getPrayerProgress_() {
  const props = PropertiesService.getDocumentProperties();
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const storedDate = props.getProperty(PRAYER_PROGRESS_DATE_KEY_);
  const completed = storedDate === today ? parseInt(props.getProperty(PRAYER_PROGRESS_COUNT_KEY_) || '0', 10) : 0;
  const remaining = getAllItems_().total;
  const total = completed + remaining;

  return {
    completed: completed,
    remaining: remaining,
    total: total,
    rate: total > 0 ? Math.round((completed / total) * 100) : 100
  };
}

// ========== 代禱卡片：資料 API（fetch 用，前端一次撈全部、本地翻頁） ==========

function handleCardApi_(e, action) {
  let result;
  try {
    switch (action) {
      case 'getAllItems':
        result = getAllItems_();
        break;
      case 'getFixedRosterItems':
        result = getFixedRosterItems_();
        break;
      case 'completeByRow':
        result = completeByRow_(parseInt(e.parameter.row, 10));
        break;
      case 'deleteByRow':
        result = deleteByRow_(parseInt(e.parameter.row, 10));
        break;
      case 'updateNoteByRow':
        result = updateFieldByRow_(parseInt(e.parameter.row, 10), COL.NOTE, e.parameter.value);
        break;
      case 'updateCycleByRow': {
        const key = (e.parameter.value || '').toString().trim().toUpperCase();
        const value = CYCLE_MAP[key] || e.parameter.value;
        result = updateFieldByRow_(parseInt(e.parameter.row, 10), COL.CYCLE, value);
        break;
      }
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
 * 一次把「今天待代禱清單」全部抓出來（一次 getValues，不逐列讀取），
 * 每筆資料附上實際工作表列號（row），前端存成本地暫存區，
 * 之後翻頁、隨機、跳項都直接用本地資料，不用再打 API。
 */
function getAllItems_() {
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { items: [], total: 0 };

  const numRows = lastRow - 1;
  const allData = sheet.getRange(2, 1, numRows, 7).getValues();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const items = [];
  for (let i = 0; i < allData.length; i++) {
    const nextVal = allData[i][COL.NEXT - 1];
    let include = false;

    if (nextVal === '' || nextVal === null || nextVal === undefined) {
      include = true;
    } else if (nextVal instanceof Date && !isNaN(nextVal.getTime())) {
      const d = new Date(nextVal);
      d.setHours(0, 0, 0, 0);
      if (d.getTime() <= today.getTime()) include = true;
    }

    if (include) {
      items.push({
        row: i + 2, // 實際工作表列號，前端用這個定位，不受清單重新排序影響
        name: allData[i][COL.NAME - 1] || '',
        cycle: allData[i][COL.CYCLE - 1] || '',
        note: allData[i][COL.NOTE - 1] || ''
      });
    }
  }

  return { items: items, total: items.length };
}

// 固定名單：CardIndexFixed.html 專用，不受今天待代禱日期篩選影響，永遠依這個順序顯示這幾位
const FIXED_ROSTER_NAMES = [
  '王銓興', '陳豪雷', '張天維', '郭大衛', '賴秀華', '江吉昇', '劉彥漢', '李麗文', '何雅雯'
];

/**
 * 依 FIXED_ROSTER_NAMES 的順序，把這幾位固定名單成員目前的資料抓出來（不受代禱日期篩選影響）。
 * 姓名在「表單回覆 1」裡如果有多筆（理論上不會，但保險起見），取第一筆命中的；
 * 完全找不到的名字，也會照樣列在清單裡（row 為 null，備註/週期空白），
 * 前端遇到 row 為 null 時，「完成」「刪除」要停用，避免對不存在的資料操作。
 */
function getFixedRosterItems_() {
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  const allData = lastRow >= 2 ? sheet.getRange(2, 1, lastRow - 1, 7).getValues() : [];

  const byName = {};
  allData.forEach((rowData, i) => {
    const name = (rowData[COL.NAME - 1] || '').toString().trim();
    if (name && !(name in byName)) {
      byName[name] = {
        row: i + 2,
        name: name,
        cycle: rowData[COL.CYCLE - 1] || '',
        note: rowData[COL.NOTE - 1] || ''
      };
    }
  });

  const items = FIXED_ROSTER_NAMES.map(name => byName[name] || { row: null, name: name, cycle: '', note: '' });
  return { items: items, total: items.length };
}

/**
 * 用實際列號標記完成（F欄寫入現在時間、G欄依週期推進）。
 * 不需要重新掃描今日清單，前端可以背景呼叫，不阻塞畫面。
 */
function completeByRow_(row) {
  if (!row || row < 2) return { success: false };
  markDone_(getSheet_(), row);
  return { success: true, row: row };
}

/**
 * 用實際列號刪除該列資料。刪除後該列以下所有列號會往前移一位，
 * 前端收到成功回應後，會自動校正本地暫存區裡所有列號 > 這個 row 的項目（各減1）。
 */
function deleteByRow_(row) {
  if (!row || row < 2) return { success: false };
  getSheet_().deleteRow(row);
  return { success: true, deletedRow: row };
}

/**
 * 用實際列號更新指定欄位（備註／週期）。
 */
function updateFieldByRow_(row, col, value) {
  if (!row || row < 2) return { success: false };
  getSheet_().getRange(row, col).setValue(value);
  return { success: true, row: row };
}

// ========== 代禱卡片：Google Sheet 內操作版本（選用） ==========
// 需要的儲存格：G1=項次 B1=姓名 B2=進度 B4=備註(可編輯) B6=週期顯示
//              D6=週期快速輸入(打D/2/3/W/DW/M/2M/S/HY/Y) B10=上一項(勾選框) B12=下一項(勾選框)

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🙏 代禱卡片')
    .addItem('🔊 開始連禱（自動朗讀＋跳下一項）', 'openReadAloudDialog')
    .addItem('🗑 設定刪除按鈕（B20，只需執行一次）', 'setupDeleteButton')
    .addSeparator()
    .addItem('🔍 預覽同名重複資料（不會修改）', 'previewMergeDuplicateNames')
    .addItem('🔗 執行合併同名重複資料（手動）', 'mergeDuplicateNames')
    .addItem('⏰ 設定每日自動合併（22:00~23:00，只需執行一次）', 'setupMergeDuplicateTrigger')
    .addToUi();
}

// 週期換算約略天數，用來在週期不一致時判斷「最短週期」
const CYCLE_DAYS_ = {
  '每天': 1, '每兩天': 2, '每三天': 3, '每四天': 4, '每五天': 5, '每週': 7, '每兩週': 14,
  '每月': 30, '每兩個月': 60, '每季': 90, '每半年': 182, '每年': 365
};

/**
 * 從多個週期裡挑出「最短」的一個（代禱頻率最密集的）
 */
function pickShortestCycle_(cycles) {
  let shortest = cycles[0];
  let shortestDays = CYCLE_DAYS_[shortest] !== undefined ? CYCLE_DAYS_[shortest] : Infinity;
  cycles.forEach(c => {
    const days = CYCLE_DAYS_[c] !== undefined ? CYCLE_DAYS_[c] : Infinity;
    if (days < shortestDays) {
      shortest = c;
      shortestDays = days;
    }
  });
  return shortest;
}

/**
 * 掃描「表單回覆 1」，找出姓名重複的列，回傳合併預覽資訊（不修改任何資料）。
 * @return {Array} [{ name, count, mergedNote, cycles, finalCycle, hasConflict }]
 */
function scanDuplicateGroups_() {
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const numRows = lastRow - 1;
  const data = sheet.getRange(2, 1, numRows, 7).getValues();

  const groups = {}; // name -> [{row, timestamp, cycle, note, email, thisPrayer, nextPrayer}]
  data.forEach((row, i) => {
    const name = String(row[COLUMNS.name - 1] || '').trim();
    if (!name) return;
    if (!groups[name]) groups[name] = [];
    groups[name].push({
      row: i + 2,
      timestamp: row[COLUMNS.timestamp - 1],
      cycle: String(row[COLUMNS.cycle - 1] || '').trim(),
      note: String(row[COLUMNS.note - 1] || '').trim(),
      email: String(row[COLUMNS.email - 1] || '').trim(),
      thisPrayer: row[COLUMNS.thisPrayer - 1],
      nextPrayer: row[COLUMNS.nextPrayer - 1]
    });
  });

  const result = [];
  Object.keys(groups).forEach(name => {
    const rows = groups[name];
    if (rows.length <= 1) return;

    // 依時間戳記排序，最新的排最後（時間戳記無效的當作最舊）
    rows.sort((a, b) => {
      const ta = a.timestamp instanceof Date ? a.timestamp.getTime() : 0;
      const tb = b.timestamp instanceof Date ? b.timestamp.getTime() : 0;
      return ta - tb;
    });

    const notes = [];
    const cycles = [];
    rows.forEach(r => {
      if (r.note && notes.indexOf(r.note) === -1) notes.push(r.note);
      if (r.cycle && cycles.indexOf(r.cycle) === -1) cycles.push(r.cycle);
    });

    const latest = rows[rows.length - 1];
    const finalCycle = cycles.length === 1 ? cycles[0] : (cycles.length > 1 ? pickShortestCycle_(cycles) : '');

    result.push({
      name: name,
      rows: rows,
      count: rows.length,
      mergedNote: notes.join('\n'),
      cycles: cycles,
      finalCycle: finalCycle,
      hasConflict: cycles.length > 1
    });
  });

  return result;
}

/**
 * 預覽會合併哪些同名資料，跳出視窗列出清單，不會修改任何資料。
 */
function previewMergeDuplicateNames() {
  const groups = scanDuplicateGroups_();
  if (groups.length === 0) {
    safeAlert('沒有發現同名重複的資料。');
    return;
  }

  let msg = '發現 ' + groups.length + ' 組同名重複資料：\n\n';
  groups.forEach(g => {
    msg += '【' + g.name + '】共 ' + g.count + ' 筆 → 合併為 1 筆\n';
    msg += '週期：' + (g.hasConflict
      ? ('不一致（' + g.cycles.join('、') + '），將採用最短週期＝' + g.finalCycle)
      : (g.finalCycle || '(皆未設定)'));
    msg += '\n------------------------------\n';
  });
  msg += '\n確認沒問題後，請執行選單「🔗 執行合併同名重複資料」。';

  safeAlert(msg);
  Logger.log(msg);
}

/**
 * 實際執行合併：同名的多列合併成一列（保留最早的列位置），
 * 備註合併去重複、週期一致就沿用、不一致則採用最短的週期（並記錄在執行紀錄 Logger 裡）、
 * 本次代禱／下次代禱採用最新一筆的值。合併後其餘列刪除。
 */
function mergeDuplicateNames() {
  const groups = scanDuplicateGroups_();
  if (groups.length === 0) {
    safeAlert('沒有發現同名重複的資料，不需要合併。');
    return;
  }

  const ui = SpreadsheetApp.getUi();
  const confirmMsg = '即將合併 ' + groups.length + ' 組同名重複資料（詳細內容請先用「預覽」確認），\n' +
    '每組會保留 1 筆、其餘刪除，此動作無法復原，確定要執行嗎？';
  const response = ui.alert('確認執行合併', confirmMsg, ui.ButtonSet.YES_NO);
  if (response !== ui.Button.YES) return;

  const sheet = getSheet_();
  const conflictNames = [];
  const rowsToDelete = [];

  groups.forEach(g => {
    if (g.hasConflict) conflictNames.push(g.name + '（' + g.cycles.join('、') + ' → 採用 ' + g.finalCycle + '）');

    const sortedRows = g.rows.slice(); // 已依時間戳記排序，最新在最後
    const latest = sortedRows[sortedRows.length - 1];
    const keepRow = Math.min.apply(null, sortedRows.map(r => r.row)); // 保留列號最小（最早）的位置

    const email = sortedRows.map(r => r.email).filter(Boolean).pop() || '';
    let thisPrayer = latest.thisPrayer instanceof Date && !isNaN(latest.thisPrayer.getTime()) ? latest.thisPrayer : '';
    let nextPrayer = latest.nextPrayer instanceof Date && !isNaN(latest.nextPrayer.getTime()) ? latest.nextPrayer : '';

    // 如果最新一筆的下次代禱也是空的，用週期補算一個
    if (!nextPrayer && g.finalCycle) {
      nextPrayer = computeNextDate_(new Date(), g.finalCycle);
    }

    sheet.getRange(keepRow, COLUMNS.cycle).setValue(g.finalCycle);
    sheet.getRange(keepRow, COLUMNS.note).setValue(g.mergedNote);
    if (email) sheet.getRange(keepRow, COLUMNS.email).setValue(email);
    if (thisPrayer) {
      sheet.getRange(keepRow, COLUMNS.thisPrayer).setValue(thisPrayer);
      sheet.getRange(keepRow, COLUMNS.thisPrayer).setNumberFormat('yyyy/MM/dd HH:mm:ss');
    }
    if (nextPrayer) {
      sheet.getRange(keepRow, COLUMNS.nextPrayer).setValue(nextPrayer);
      sheet.getRange(keepRow, COLUMNS.nextPrayer).setNumberFormat('yyyy/MM/dd HH:mm:ss');
    }

    sortedRows.forEach(r => {
      if (r.row !== keepRow) rowsToDelete.push(r.row);
    });
  });

  // 所有組別的寫入都做完後，統一由下往上刪除，避免刪除中途列號位移互相干擾
  rowsToDelete.sort((a, b) => b - a);
  rowsToDelete.forEach(r => sheet.deleteRow(r));

  let summary = '✅ 已合併 ' + groups.length + ' 組同名重複資料，共刪除 ' + rowsToDelete.length + ' 筆多餘資料列。';
  if (conflictNames.length > 0) {
    summary += '\n\n⚠️ 以下姓名週期不一致，已自動採用最短週期，建議事後複核：\n' + conflictNames.join('\n');
  }
  safeAlert(summary);
  Logger.log(summary);
}

/**
 * 自動排程專用版：邏輯跟 mergeDuplicateNames 完全一樣，
 * 但拿掉所有 ui.alert 跳窗互動（定時觸發器沒有畫面環境，呼叫 UI 會直接報錯），
 * 改成寫入執行紀錄（Logger）+ 寄一封 Email 通知結果。
 */
function mergeDuplicateNamesAuto() {
  const RECEIVER_EMAIL = '528david@gmail.com'; // 跟你既有的禱告報表用同一個信箱，要改請直接改這行

  const groups = scanDuplicateGroups_();
  if (groups.length === 0) {
    Logger.log('沒有發現同名重複的資料，不需要合併。');
    return;
  }

  const sheet = getSheet_();
  const conflictNames = [];
  const rowsToDelete = [];

  groups.forEach(g => {
    if (g.hasConflict) conflictNames.push(g.name + '（' + g.cycles.join('、') + ' → 採用 ' + g.finalCycle + '）');

    const sortedRows = g.rows.slice();
    const latest = sortedRows[sortedRows.length - 1];
    const keepRow = Math.min.apply(null, sortedRows.map(r => r.row));

    const email = sortedRows.map(r => r.email).filter(Boolean).pop() || '';
    let thisPrayer = latest.thisPrayer instanceof Date && !isNaN(latest.thisPrayer.getTime()) ? latest.thisPrayer : '';
    let nextPrayer = latest.nextPrayer instanceof Date && !isNaN(latest.nextPrayer.getTime()) ? latest.nextPrayer : '';

    if (!nextPrayer && g.finalCycle) {
      nextPrayer = computeNextDate_(new Date(), g.finalCycle);
    }

    sheet.getRange(keepRow, COLUMNS.cycle).setValue(g.finalCycle);
    sheet.getRange(keepRow, COLUMNS.note).setValue(g.mergedNote);
    if (email) sheet.getRange(keepRow, COLUMNS.email).setValue(email);
    if (thisPrayer) {
      sheet.getRange(keepRow, COLUMNS.thisPrayer).setValue(thisPrayer);
      sheet.getRange(keepRow, COLUMNS.thisPrayer).setNumberFormat('yyyy/MM/dd HH:mm:ss');
    }
    if (nextPrayer) {
      sheet.getRange(keepRow, COLUMNS.nextPrayer).setValue(nextPrayer);
      sheet.getRange(keepRow, COLUMNS.nextPrayer).setNumberFormat('yyyy/MM/dd HH:mm:ss');
    }

    sortedRows.forEach(r => {
      if (r.row !== keepRow) rowsToDelete.push(r.row);
    });
  });

  rowsToDelete.sort((a, b) => b - a);
  rowsToDelete.forEach(r => sheet.deleteRow(r));

  const todayStr = Utilities.formatDate(new Date(), 'GMT+8', 'yyyy-MM-dd');
  let summary = '✅ 已合併 ' + groups.length + ' 組同名重複資料，共刪除 ' + rowsToDelete.length + ' 筆多餘資料列。';
  if (conflictNames.length > 0) {
    summary += '\n\n⚠️ 以下姓名週期不一致，已自動採用最短週期，建議事後複核：\n' + conflictNames.join('\n');
  }

  Logger.log(summary);

  try {
    MailApp.sendEmail(
      RECEIVER_EMAIL,
      '🔗【代禱資料自動合併通知】- ' + todayStr,
      summary + '\n\n此信件為系統自動發送，請勿直接回覆。'
    );
  } catch (e) {
    Logger.log('寄送合併通知信失敗：' + e.toString());
  }
}

/**
 * 設定每日 22:00~23:00 自動執行合併重複資料（只需執行一次）。
 * Apps Script編輯器上方函式下拉選單選 setupMergeDuplicateTrigger → 執行 ▶
 */
function setupMergeDuplicateTrigger() {
  const functionName = 'mergeDuplicateNamesAuto';

  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === functionName) {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  ScriptApp.newTrigger(functionName)
    .timeBased()
    .everyDays(1)
    .atHour(22)
    .create();

  Logger.log('✅ 已設定每日 22:00~23:00 自動合併同名重複資料。');
  safeAlert('✅ 已設定每日 22:00~23:00 自動合併同名重複資料，結果會寄到 Email 通知你。');
}

function safeAlert(msg) {
  try {
    SpreadsheetApp.getUi().alert(msg);
  } catch (err) {
    Logger.log(msg);
  }
}

function onEdit(e) {
  const sheet = e.range.getSheet();
  if (sheet.getName() !== CARD_SHEET_NAME) return;

  const a1 = e.range.getA1Notation();
  const dataSheet = getSheet_();

  if (a1 === 'G1') {
    const rows = getFilteredList_(dataSheet);
    const total = rows.length;
    let idx = e.range.getValue();
    if (!idx || idx < 1) { idx = 1; e.range.setValue(1); }
    else if (idx > total && total > 0) { idx = total; e.range.setValue(total); }
    refreshCard_(sheet, dataSheet, idx);
    return;
  }

  if (a1 === 'B10') {
    if (e.range.getValue() === true) { goPrevCard_(sheet); e.range.setValue(false); }
    return;
  }

  if (a1 === 'B12') {
    if (e.range.getValue() === true) { goNextCard_(sheet); e.range.setValue(false); }
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
        deleteCurrentCardItem_(sheet);
      }
    }
    return;
  }

  if (a1 === 'B4') {
    const rows = getFilteredList_(dataSheet);
    const idx = sheet.getRange('G1').getValue();
    if (idx >= 1 && idx <= rows.length) {
      dataSheet.getRange(rows[idx - 1], COL.NOTE).setValue(e.range.getValue());
    }
    return;
  }

  if (a1 === 'D6') {
    let newValue = e.range.getValue();
    if (!newValue) return;
    const key = newValue.toString().trim().toUpperCase();
    const matched = CYCLE_MAP[key];
    if (matched) {
      e.range.setValue(matched);
      newValue = matched;
    } else {
      newValue = newValue.toString();
    }
    const rows = getFilteredList_(dataSheet);
    const idx = sheet.getRange('G1').getValue();
    if (idx >= 1 && idx <= rows.length) {
      dataSheet.getRange(rows[idx - 1], COL.CYCLE).setValue(newValue);
      refreshCard_(sheet, dataSheet, idx);
    }
    return;
  }
}

function goNextCard_(cardSheet) {
  const dataSheet = getSheet_();
  const rowsBefore = getFilteredList_(dataSheet);
  const idxCell = cardSheet.getRange('G1');
  let idx = idxCell.getValue() || 0;

  if (idx >= 1 && idx <= rowsBefore.length) markDone_(dataSheet, rowsBefore[idx - 1]);

  const rowsAfter = getFilteredList_(dataSheet);
  const total = rowsAfter.length;

  if (total === 0) { idxCell.setValue(0); refreshCard_(cardSheet, dataSheet, 0); return; }

  const newIdx = idx > total || idx < 1 ? 1 : idx;
  idxCell.setValue(newIdx);
  refreshCard_(cardSheet, dataSheet, newIdx);
}

function goPrevCard_(cardSheet) {
  const dataSheet = getSheet_();
  const rows = getFilteredList_(dataSheet);
  const total = rows.length;
  const idxCell = cardSheet.getRange('G1');

  if (total === 0) { idxCell.setValue(0); refreshCard_(cardSheet, dataSheet, 0); return; }

  let idx = idxCell.getValue() || 1;
  idx = idx - 1 < 1 ? total : idx - 1;
  idxCell.setValue(idx);
  refreshCard_(cardSheet, dataSheet, idx);
}

/**
 * 刪除目前這項（B20觸發，經過確認對話框後才會呼叫）。
 * 直接從「表單回覆 1」刪除該列，刪除後今日清單自然位移，沿用同一個 idx 就會對應到下一項。
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
    refreshCard_(cardSheet, dataSheet, 0);
    return;
  }

  const newIdx = idx > total || idx < 1 ? 1 : idx;
  idxCell.setValue(newIdx);
  refreshCard_(cardSheet, dataSheet, newIdx);
}

/**
 * 一次性設定函式：在「代禱卡片」分頁自動建立「刪除此項」的核取方塊按鈕（B20）。
 * 只需要執行一次：Apps Script編輯器上方函式下拉選單選 setupDeleteButton → 執行 ▶
 */
function setupDeleteButton() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cardSheet = ss.getSheetByName(CARD_SHEET_NAME);
  if (!cardSheet) {
    SpreadsheetApp.getUi().alert('找不到「' + CARD_SHEET_NAME + '」分頁，請確認分頁名稱是否一致。');
    return;
  }

  cardSheet.getRange('B20').insertCheckboxes();
  cardSheet.getRange('C20').setValue('🗑 刪除此項（不可復原）').setFontSize(13).setFontColor('#b0413e');
  cardSheet.getRange('B20:C20').setBackground('#fdeceb');
  cardSheet.setRowHeight(20, 32);

  SpreadsheetApp.getUi().alert('✅ 已在 B20 建立刪除按鈕。這個勾選框打勾後會跳出確認對話框，確認才會真的刪除資料。');
}

function refreshCard_(cardSheet, dataSheet, idx) {
  const rows = getFilteredList_(dataSheet);
  cardSheet.getRange('D6').setValue('');

  if (rows.length === 0) {
    cardSheet.getRange('B1').setValue('🎉 今天沒有待代禱的事項');
    cardSheet.getRange('B2').setValue('');
    cardSheet.getRange('B4').setValue('');
    cardSheet.getRange('B6').setValue('目前週期：');
    return;
  }

  if (idx < 1) idx = 1;
  if (idx > rows.length) idx = ((idx - 1) % rows.length) + 1;

  const row = rows[idx - 1];
  const rowData = dataSheet.getRange(row, 1, 1, 7).getValues()[0];

  cardSheet.getRange('B1').setValue(rowData[COL.NAME - 1] || '');
  cardSheet.getRange('B2').setValue('第 ' + idx + ' 項 / 共 ' + rows.length + ' 項（今日待代禱）');
  cardSheet.getRange('B4').setValue(rowData[COL.NOTE - 1] || '');
  cardSheet.getRange('B6').setValue('目前週期：' + (rowData[COL.CYCLE - 1] || ''));
}

// ========== 朗讀彈出視窗（搭配 Google Sheet 版卡片使用） ==========

function dialogGetState() {
  const cardSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CARD_SHEET_NAME);
  const dataSheet = getSheet_();
  const rows = getFilteredList_(dataSheet);
  const idx = cardSheet.getRange('G1').getValue() || 0;
  const name = cardSheet.getRange('B1').getValue().toString();
  const note = cardSheet.getRange('B4').getValue().toString();
  return { text: (name ? name + '。' : '') + note, index: idx, total: rows.length };
}

function dialogAdvance() {
  const cardSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CARD_SHEET_NAME);
  goNextCard_(cardSheet);
  return dialogGetState();
}

function openReadAloudDialog() {
  const html = `
    <!DOCTYPE html>
    <html><head><meta charset="UTF-8"></head>
    <body style="font-family:-apple-system,sans-serif;padding:24px;text-align:center;">
      <div id="itemInfo" style="font-size:13px;color:#999;"></div>
      <div id="status" style="font-size:16px;color:#674ea7;font-weight:bold;margin-top:8px;">準備連禱中...</div>
      <div id="progress" style="margin-top:10px;font-size:14px;color:#666;"></div>
      <button id="stopBtn" style="margin-top:20px;padding:8px 20px;border-radius:8px;border:1px solid #674ea7;background:white;color:#674ea7;font-size:14px;">⏹ 停止連禱</button>
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
          voice = voices.find(v => v.lang === 'zh-TW') || voices.find(v => v.lang && v.lang.toLowerCase().startsWith('zh')) || null;
        }
        if (window.speechSynthesis) { pickVoice(); window.speechSynthesis.onvoiceschanged = pickVoice; }
        function speakOnce(t) {
          return new Promise((resolve) => {
            if (!window.speechSynthesis || !t || !t.trim()) { resolve(); return; }
            const utter = new SpeechSynthesisUtterance(t);
            utter.lang = 'zh-TW'; if (voice) utter.voice = voice; utter.rate = 0.95;
            utter.onend = resolve; utter.onerror = resolve;
            window.speechSynthesis.speak(utter);
          });
        }
        function callServer(fnName) {
          return new Promise((resolve, reject) => {
            google.script.run.withSuccessHandler(resolve).withFailureHandler(reject)[fnName]();
          });
        }
        async function run() {
          let state = await callServer('dialogGetState');
          if (!state || state.total === 0) {
            document.getElementById('status').textContent = '🎉 今天沒有需要代禱的事項';
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
              document.getElementById('status').textContent = '🎉 今天的代禱事項都完成了';
              document.getElementById('progress').textContent = '';
              setTimeout(() => google.script.host.close(), 2000);
              return;
            }
            document.getElementById('status').textContent = '連禱中...';
          }
        }
        setTimeout(run, 300);
      </script>
    </body></html>
  `;
  const output = HtmlService.createHtmlOutput(html).setWidth(340).setHeight(220);
  SpreadsheetApp.getUi().showModalDialog(output, '🔊 連禱中');
}