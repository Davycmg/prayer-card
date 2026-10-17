/**
 * 「工作日」清單：卡片上按「💼 工作日」會把 Google Tasks 預設清單的任務搬到「工作日」清單，
 * 每週一凌晨 3 點左右再自動全部搬回預設清單。
 *
 * 首次使用：到 Apps Script 編輯器手動執行一次 setupWorkdayMondayTrigger()，授權並建立每週一 03:00 的觸發器。
 */
const WORKDAY_LIST_NAME = '工作日';

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
  const copy = { title: task.title || '（無標題）', notes: task.notes || '' };
  if (task.due) copy.due = task.due;
  withRetry_(() => Tasks.Tasks.insert(copy, toListId));
  withRetry_(() => Tasks.Tasks.remove(fromListId, task.id));
  Utilities.sleep(300);
}

// 前端 action: moveTaskToWorkdayList
function moveTaskToWorkdayList(taskId) {
  if (!taskId) throw new Error('缺少 Task ID');
  const defaultListId = getDefaultTaskListId_();
  const workdayList = findOrCreateTaskList_(WORKDAY_LIST_NAME);
  if (workdayList.id === defaultListId) throw new Error('「工作日」清單不能是預設清單');
  // 任務可能已經不在預設清單（頁面開著期間被搬走），先找出它實際所在的清單
  const sourceListId = resolveTaskListId_(taskId, defaultListId);
  if (sourceListId === workdayList.id) return { success: true, alreadyThere: true };
  const task = Tasks.Tasks.get(sourceListId, taskId);
  moveTaskBetweenLists_(task, sourceListId, workdayList.id);
  return { success: true };
}

// 每週一觸發：把「工作日」清單裡未完成的任務全部搬回預設清單
function moveWorkdayTasksToDefault() {
  const defaultListId = getDefaultTaskListId_();
  const workdayList = (Tasks.Tasklists.list({ maxResults: 100 }).items || [])
    .find(l => l.title === WORKDAY_LIST_NAME);
  if (!workdayList || workdayList.id === defaultListId) return 0;

  // 搬完一批後原清單內容就變了，所以每輪都重新查詢，直到清空為止
  let moved = 0;
  while (true) {
    const items = Tasks.Tasks.list(workdayList.id, { showCompleted: false, maxResults: 100 }).items || [];
    if (items.length === 0) break;
    items.forEach(task => moveTaskBetweenLists_(task, workdayList.id, defaultListId));
    moved += items.length;
  }
  Logger.log('已把 ' + moved + ' 項從「工作日」搬回預設清單');
  return moved;
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
