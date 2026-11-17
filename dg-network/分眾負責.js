// ========== AllCard.html（?view=all）分眾：不同代禱對象由不同的人負責 ==========
// 「分眾負責」分頁（第一次用會自動建立），一列＝一位代禱對象 × 一位負責人：
//   A 代禱對象（跟「表單回覆 1」B 欄姓名一樣）  B 負責人  C 本次代禱  D 下次代禱
// - 一位代禱對象可以有好幾位負責人，每位負責人各自完成、各自算下次代禱日期（C／D 欄），
//   A 完成不影響 B，也不動「表單回覆 1」的 F／G 欄。
// - 週期、備註仍以「表單回覆 1」為準（大家共用）。
// - 沒有任何負責人的代禱對象＝「未分配」，照舊用「表單回覆 1」的 F／G 欄判斷今天要不要代禱。
// - 用姓名對應（不用列號），所以「表單回覆 1」刪列、合併同名資料都不會對錯人。
// - 負責人名單就是這個分頁 B 欄出現過的名字；也可以直接在試算表裡編輯這個分頁。

const GROUP_SHEET_NAME = '分眾負責';
const GROUP_COL = { NAME: 1, WHO: 2, THIS: 3, NEXT: 4 };

function getGroupSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(GROUP_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(GROUP_SHEET_NAME);
    sheet.getRange(1, 1, 1, 4).setValues([['代禱對象', '負責人', '本次代禱', '下次代禱']]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function groupNorm_(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

// 讀整個分頁：[{ r（列號）, name, who, thisVal, nextVal }]
function readGroupRows_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
  const rows = [];
  values.forEach((v, i) => {
    const name = groupNorm_(v[0]);
    const who = groupNorm_(v[1]);
    if (!name || !who) return;
    rows.push({ r: i + 2, name: name, who: who, thisVal: v[2], nextVal: v[3] });
  });
  return rows;
}

// 姓名 → [負責人…]
function getAssigneeMap_() {
  const map = {};
  readGroupRows_(getGroupSheet_()).forEach(row => {
    if (!map[row.name]) map[row.name] = [];
    if (map[row.name].indexOf(row.who) === -1) map[row.name].push(row.who);
  });
  return map;
}

function getGroupAssignees_() {
  const set = {};
  readGroupRows_(getGroupSheet_()).forEach(row => { set[row.who] = true; });
  return { assignees: Object.keys(set).sort((a, b) => a.localeCompare(b, 'zh-Hant')) };
}

// 「表單回覆 1」所有人（不看日期），同名合併（跟 getAllItems_ 同一套去重複規則）：姓名 → item
function getMainItemsByName_() {
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return {};
  const data = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
  const items = [];
  data.forEach((v, i) => {
    items.push({ row: i + 2, name: v[COL.NAME - 1] || '', cycle: v[COL.CYCLE - 1] || '', note: v[COL.NOTE - 1] || '' });
  });
  const map = {};
  dedupeItemsByName_(items).forEach(item => {
    const name = groupNorm_(item.name);
    if (name && !map[name]) map[name] = item;
  });
  return map;
}

function isDueToday_(nextVal) {
  if (nextVal === '' || nextVal === null || nextVal === undefined) return true;
  if (!(nextVal instanceof Date) || isNaN(nextVal.getTime())) return true;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(nextVal);
  d.setHours(0, 0, 0, 0);
  return d.getTime() <= today.getTime();
}

// getAllItems 加上每位代禱對象的負責人（前端「全部」「未分配」用）
function getAllItemsWithAssignees_() {
  const result = getAllItems_();
  const map = getAssigneeMap_();
  result.items.forEach(item => { item.assignees = map[groupNorm_(item.name)] || []; });
  return result;
}

// 某位負責人今天要代禱的清單：依他自己的「下次代禱」（D 欄）判斷
function getGroupItems_(who) {
  who = groupNorm_(who);
  if (!who) throw new Error('請先選擇負責人');
  const rows = readGroupRows_(getGroupSheet_());
  const mainByName = getMainItemsByName_();
  const assigneeMap = {};
  rows.forEach(row => {
    if (!assigneeMap[row.name]) assigneeMap[row.name] = [];
    if (assigneeMap[row.name].indexOf(row.who) === -1) assigneeMap[row.name].push(row.who);
  });

  const items = [];
  const seen = {};
  let assignedTotal = 0;
  rows.forEach(row => {
    if (row.who !== who || seen[row.name]) return;
    const main = mainByName[row.name];
    if (!main) return; // 「表單回覆 1」已經沒有這個人（被刪掉），略過
    seen[row.name] = true;
    assignedTotal++;
    if (!isDueToday_(row.nextVal)) return;
    items.push({
      row: main.row, name: main.name, cycle: main.cycle, note: main.note,
      assignees: assigneeMap[row.name] || []
    });
  });
  return { items: items, total: items.length, assignedTotal: assignedTotal };
}

function withGroupLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function assignPerson_(name, who) {
  name = groupNorm_(name);
  who = groupNorm_(who);
  if (!name || !who) throw new Error('姓名和負責人都要填');
  return withGroupLock_(() => {
    const sheet = getGroupSheet_();
    const exists = readGroupRows_(sheet).some(row => row.name === name && row.who === who);
    if (!exists) sheet.appendRow([name, who, '', '']);
    return { success: true, name: name, who: who, assignees: (getAssigneeMap_()[name] || []) };
  });
}

function unassignPerson_(name, who) {
  name = groupNorm_(name);
  who = groupNorm_(who);
  return withGroupLock_(() => {
    const sheet = getGroupSheet_();
    const rows = readGroupRows_(sheet).filter(row => row.name === name && row.who === who);
    // 回傳原本的日期，操作歷程「復原」用（重新指派時把日期放回去）
    const first = rows[0];
    const old = first ? { oldThis: serializeCell_(first.thisVal), oldNext: serializeCell_(first.nextVal) } : {};
    rows.sort((a, b) => b.r - a.r).forEach(row => sheet.deleteRow(row.r));
    return Object.assign({ success: true, name: name, who: who, assignees: (getAssigneeMap_()[name] || []) }, old);
  });
}

// 復原「移除負責人」：加回來並放回原本的日期
function reassignPerson_(name, who, oldThis, oldNext) {
  name = groupNorm_(name);
  who = groupNorm_(who);
  return withGroupLock_(() => {
    const sheet = getGroupSheet_();
    const exists = readGroupRows_(sheet).some(row => row.name === name && row.who === who);
    if (!exists) sheet.appendRow([name, who, deserializeCell_(oldThis), deserializeCell_(oldNext)]);
    return { success: true, name: name, who: who };
  });
}

function findGroupRow_(sheet, name, who) {
  name = groupNorm_(name);
  who = groupNorm_(who);
  const row = readGroupRows_(sheet).find(r => r.name === name && r.who === who);
  if (!row) throw new Error('「' + who + '」沒有負責「' + name + '」（可能剛被移除），請重新整理');
  return row;
}

// 負責人各自完成：只改「分眾負責」這一列的 C／D 欄，跟 markDone_ 一樣的推算方式
function completeForAssignee_(name, who) {
  return withGroupLock_(() => {
    const sheet = getGroupSheet_();
    const row = findGroupRow_(sheet, name, who);
    const main = getMainItemsByName_()[row.name];
    const cycle = main ? String(main.cycle || '').trim() : '';
    const now = new Date();

    let base = row.nextVal;
    if (!(base instanceof Date) || isNaN(base.getTime())) base = now;
    let next = computeNextDate_(base, cycle);
    let guard = 0;
    while (next <= now && guard < 500) {
      next = computeNextDate_(next, cycle);
      guard++;
    }

    const oldThis = serializeCell_(row.thisVal);
    const oldNext = serializeCell_(row.nextVal);
    sheet.getRange(row.r, GROUP_COL.THIS).setValue(now).setNumberFormat('yyyy/MM/dd HH:mm:ss');
    sheet.getRange(row.r, GROUP_COL.NEXT).setValue(next).setNumberFormat('yyyy/MM/dd HH:mm:ss');
    recordPrayerCompleted_();
    return {
      success: true, oldThis: oldThis, oldNext: oldNext,
      newDate: Utilities.formatDate(next, Session.getScriptTimeZone(), 'yyyy/MM/dd')
    };
  });
}

function undoCompleteForAssignee_(name, who, oldThis, oldNext) {
  return withGroupLock_(() => {
    const sheet = getGroupSheet_();
    const row = findGroupRow_(sheet, name, who);
    sheet.getRange(row.r, GROUP_COL.THIS).setValue(deserializeCell_(oldThis));
    sheet.getRange(row.r, GROUP_COL.NEXT).setValue(deserializeCell_(oldNext));
    const props = PropertiesService.getDocumentProperties();
    const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    if (props.getProperty(PRAYER_PROGRESS_DATE_KEY_) === today) {
      const count = parseInt(props.getProperty(PRAYER_PROGRESS_COUNT_KEY_) || '0', 10);
      props.setProperty(PRAYER_PROGRESS_COUNT_KEY_, String(Math.max(0, count - 1)));
    }
    return { success: true };
  });
}

// handleCardApi_ 呼叫：這個檔案負責的 action，不是的話回 undefined
function handleGroupApi_(e, action) {
  const p = e.parameter;
  switch (action) {
    case 'getAllItemsWithAssignees': return getAllItemsWithAssignees_();
    case 'getGroupItems': return getGroupItems_(p.who);
    case 'getGroupAssignees': return getGroupAssignees_();
    case 'assignPerson': return assignPerson_(p.name, p.who);
    case 'unassignPerson': return unassignPerson_(p.name, p.who);
    case 'reassignPerson': return reassignPerson_(p.name, p.who, p.oldThis, p.oldNext);
    case 'completeForAssignee': return completeForAssignee_(p.name, p.who);
    case 'undoCompleteForAssignee': return undoCompleteForAssignee_(p.name, p.who, p.oldThis, p.oldNext);
    default: return undefined;
  }
}
