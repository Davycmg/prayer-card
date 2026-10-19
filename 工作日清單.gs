/**
 * 「工作日」清單：卡片上按「💼 工作日」會把 Google Tasks 預設清單的任務搬到「工作日」清單，
 * 每週一凌晨 3 點左右再自動全部搬回預設清單。
 *
 * 首次使用：到 Apps Script 編輯器手動執行一次 setupWorkdayMondayTrigger()，授權並建立每週一 03:00 的觸發器。
 *
 * 「週末」清單同理：按「🛌 週末」搬到「週末」清單，每週六 03:00 搬回預設清單；
 * 需另外手動執行一次 setupWeekendSaturdayTrigger() 建立觸發器。
 */
const WORKDAY_LIST_NAME = '工作日';
const WEEKEND_LIST_NAME = '週末';

// Tasks API 沒有跨清單搬移的功能，所以用「在目標清單新增一份 + 刪掉原本那份」達成。
// 連續大量呼叫會碰到 Quota Exceeded（短時間內請求太密），所以每次呼叫遇到錯誤就等一下重試，
// 每搬完一項也稍微停一下。
function withRetry_(fn) {
  let wait = 2000;
  for (let i = 0; i < 6; i++) {
    try {
      return fn();
    } catch (err) {
      if (i === 5 || !/quota|rate|limit|backend|503|500/i.test(String(err))) throw err;
      Utilities.sleep(wait);
      wait *= 2;
    }
  }
}

function moveTaskBetweenLists_(task, fromListId, toListId) {
  // 從 Google Chat／文件指派來的任務，Tasks API 不允許刪除；先擋下，免得「複本建好了、原本刪不掉」留下重複項
  if (task.assignmentInfo) {
    throw new Error('這是從 Google Chat 或文件指派來的待辦，Google 不允許程式搬移，請到 Google Tasks 裡手動拖到目標清單');
  }
  const copy = { title: task.title || '（無標題）', notes: task.notes || '' };
  if (task.due) copy.due = task.due;
  const inserted = withRetry_(() => Tasks.Tasks.insert(copy, toListId));
  try {
    withRetry_(() => Tasks.Tasks.remove(fromListId, task.id));
  } catch (err) {
    // 原本那項刪不掉：把剛建的複本撤掉，維持「沒搬」的狀態，不要兩邊各一份
    try { Tasks.Tasks.remove(toListId, inserted.id); } catch (e) { /* 撤不掉就算了，下面照樣報錯 */ }
    if (String(err).indexOf('permission') !== -1) {
      throw new Error('Google 不允許程式搬移這個待辦（通常是從 Google Chat 或文件指派來的任務），請到 Google Tasks 裡手動拖到目標清單');
    }
    throw err;
  }
  Utilities.sleep(300);
}

/**
 * 手動執行一次：清掉之前「移到工作日」失敗時留在「工作日」清單的重複複本。
 * 判斷方式：「工作日」清單裡未完成的任務，標題跟預設清單裡某個未完成任務完全相同 → 視為複本刪掉
 * （原本那項還在預設清單，所以刪複本不會少任何東西）。同一標題在「工作日」裡有多份也全部刪掉。
 * 預設先試算（dryRun）只印出會刪哪些，確認後改執行 cleanupWorkdayDuplicatesRun()。
 */
function cleanupWorkdayDuplicates(dryRun) {
  if (dryRun === undefined) dryRun = true;
  const defaultListId = getDefaultTaskListId_();
  const workdayList = (Tasks.Tasklists.list({ maxResults: 100 }).items || [])
    .find(l => l.title === WORKDAY_LIST_NAME);
  if (!workdayList || workdayList.id === defaultListId) { Logger.log('找不到「工作日」清單'); return 0; }

  const listAll = (listId) => {
    let items = [], pageToken;
    do {
      const res = Tasks.Tasks.list(listId, { showCompleted: false, maxResults: 100, pageToken: pageToken });
      items = items.concat(res.items || []);
      pageToken = res.nextPageToken;
    } while (pageToken);
    return items;
  };
  const defaultTitles = {};
  listAll(defaultListId).forEach(t => { defaultTitles[(t.title || '').trim()] = true; });

  const dupes = listAll(workdayList.id).filter(t => defaultTitles[(t.title || '').trim()]);
  dupes.forEach(t => {
    Logger.log((dryRun ? '將刪除：' : '已刪除：') + t.title);
    if (!dryRun) { withRetry_(() => Tasks.Tasks.remove(workdayList.id, t.id)); Utilities.sleep(200); }
  });
  Logger.log((dryRun ? '試算完成，會刪除 ' : '完成，共刪除 ') + dupes.length + ' 項');
  return dupes.length;
}

function cleanupWorkdayDuplicatesRun() {
  return cleanupWorkdayDuplicates(false);
}

// 把任務從它目前所在的清單搬到指定名稱的清單
function moveTaskToNamedList_(taskId, listName) {
  if (!taskId) throw new Error('缺少 Task ID');
  const defaultListId = getDefaultTaskListId_();
  const targetList = findOrCreateTaskList_(listName);
  if (targetList.id === defaultListId) throw new Error('「' + listName + '」清單不能是預設清單');
  // 任務可能已經不在預設清單（頁面開著期間被搬走），先找出它實際所在的清單
  const sourceListId = resolveTaskListId_(taskId, defaultListId);
  if (sourceListId === targetList.id) return { success: true, alreadyThere: true };
  const task = Tasks.Tasks.get(sourceListId, taskId);
  moveTaskBetweenLists_(task, sourceListId, targetList.id);
  return { success: true };
}

// 把指定名稱清單裡未完成的任務全部搬回預設清單
function moveNamedListTasksToDefault_(listName) {
  const defaultListId = getDefaultTaskListId_();
  const list = (Tasks.Tasklists.list({ maxResults: 100 }).items || [])
    .find(l => l.title === listName);
  if (!list || list.id === defaultListId) return 0;

  // 搬完一批後原清單內容就變了，所以每輪都重新查詢，直到清空為止
  let moved = 0;
  while (true) {
    const items = Tasks.Tasks.list(list.id, { showCompleted: false, maxResults: 100 }).items || [];
    if (items.length === 0) break;
    items.forEach(task => moveTaskBetweenLists_(task, list.id, defaultListId));
    moved += items.length;
  }
  Logger.log('已把 ' + moved + ' 項從「' + listName + '」搬回預設清單');
  return moved;
}

// 前端 action: moveTaskToWorkdayList
function moveTaskToWorkdayList(taskId) {
  return moveTaskToNamedList_(taskId, WORKDAY_LIST_NAME);
}

// 前端 action: moveTaskToWeekendList
function moveTaskToWeekendList(taskId) {
  return moveTaskToNamedList_(taskId, WEEKEND_LIST_NAME);
}

// 每週一觸發：把「工作日」清單裡未完成的任務全部搬回預設清單
function moveWorkdayTasksToDefault() {
  return moveNamedListTasksToDefault_(WORKDAY_LIST_NAME);
}

// 每週六觸發：把「週末」清單裡未完成的任務全部搬回預設清單
function moveWeekendTasksToDefault() {
  return moveNamedListTasksToDefault_(WEEKEND_LIST_NAME);
}

// 手動執行一次：建立每週一 03:00 左右的觸發器（會先清掉舊的同名觸發器，避免重複）
function setupWorkdayMondayTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'moveWorkdayTasksToDefault')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('moveWorkdayTasksToDefault')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(3)
    .create();
}

// 手動執行一次：建立每週六 03:00 左右的觸發器（會先清掉舊的同名觸發器，避免重複）
function setupWeekendSaturdayTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'moveWeekendTasksToDefault')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('moveWeekendTasksToDefault')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.SATURDAY)
    .atHour(3)
    .create();
}
