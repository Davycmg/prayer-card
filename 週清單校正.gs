/**
 * all.html「📅 校正週清單（E週一～E週日）」按鈕 → doGet action fixWeekdayTaskLists → fixWeekdayTaskLists()
 *
 * 補救 apps-script-projects/google-task-weekday-scheduler 兩個每日排程漏搬的任務（例如 2026-10-29 23:44
 * 那一輪 9 個 E週四 任務遇到 Quota Exceeded 被跳過，週五還留在預設清單）：
 * 1. 預設清單／「工作區」裡標題開頭 E週X、但 X 不是今天的 → 搬回「週X」清單（等於補做 23:50 那一輪）
 * 2. 今天的「週X」清單還有任務 → 搬回預設清單（等於補做 03:50 那一輪）
 * 前綴比對規則跟 weekday-scheduler 一致（標題直接 startsWith，大小寫／全形不另外處理），
 * 今天的 E週X 留在預設清單不動。可以重複按，沒有東西要搬時什麼都不做。
 */

var WEEKDAY_FIX_LIST_NAMES = ['週日', '週一', '週二', '週三', '週四', '週五', '週六']; // index = Date.getDay()
var WEEKDAY_FIX_WORK_AREA = '工作區';
var WEEKDAY_FIX_BUDGET_MS = 4.5 * 60 * 1000;

function fixWeekdayTaskLists() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) throw new Error('上一次的校正還在跑，請等一下再按');
  try {
    return fixWeekdayTaskListsLocked_();
  } finally {
    lock.releaseLock();
  }
}

function fixWeekdayTaskListsLocked_() {
  var startTime = Date.now();
  var weekday = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Taipei' })).getDay(); // 0=週日…6=週六，跟 weekday-scheduler 同一套算法
  var todayListName = WEEKDAY_FIX_LIST_NAMES[weekday];

  var lists = Tasks.Tasklists.list({ maxResults: 100 }).items || [];
  var byTitle = {};
  lists.forEach(function (l) { byTitle[l.title] = l; });
  var defaultList = Tasks.Tasklists.get('@default');

  var movedOut = [];  // 預設清單／工作區 → 週X 清單
  var movedBack = []; // 今天的週X 清單 → 預設清單
  var failed = [];
  var more = false;

  function outOfTime() {
    if (Date.now() - startTime > WEEKDAY_FIX_BUDGET_MS) { more = true; return true; }
    return false;
  }

  // 1. 預設清單＋工作區：非今天的 E週X 搬回對應週清單
  var sources = [defaultList];
  if (byTitle[WEEKDAY_FIX_WORK_AREA]) sources.push(byTitle[WEEKDAY_FIX_WORK_AREA]);
  sources.forEach(function (src) {
    weekdayFixListAll_(src.id).forEach(function (t) {
      if (more || t.parent || outOfTime()) return;
      var name = weekdayFixPrefixListName_(t.title);
      if (!name || name === todayListName) return;
      if (!byTitle[name]) byTitle[name] = Tasks.Tasklists.insert({ title: name });
      if (weekdayFixMove_(src.id, t, byTitle[name].id)) {
        movedOut.push({ title: t.title, to: name });
      } else {
        failed.push(t.title);
      }
    });
  });

  // 2. 今天的週X 清單：剩下的搬回預設清單
  var todayList = byTitle[todayListName];
  if (todayList && !more) {
    weekdayFixListAll_(todayList.id).forEach(function (t) {
      if (more || t.parent || outOfTime()) return;
      if (weekdayFixMove_(todayList.id, t, defaultList.id)) {
        movedBack.push({ title: t.title, from: todayListName });
      } else {
        failed.push(t.title);
      }
    });
  }

  console.log('週清單校正：今天' + todayListName + '，搬回週清單 ' + movedOut.length + '、搬回預設 ' + movedBack.length + '、失敗 ' + failed.length);
  return { ok: true, today: todayListName, movedOut: movedOut, movedBack: movedBack, failed: failed, more: more };
}

function weekdayFixPrefixListName_(title) {
  if (!title || title.indexOf('E週') !== 0) return null;
  var name = '週' + title.charAt(2);
  return WEEKDAY_FIX_LIST_NAMES.indexOf(name) >= 0 ? name : null;
}

// 先把整份清單讀完再搬，避免邊翻頁邊搬造成漏掉
function weekdayFixListAll_(listId) {
  var tasks = [];
  var pageToken = null;
  do {
    var params = { showCompleted: false, showHidden: false, maxResults: 100 };
    if (pageToken) params.pageToken = pageToken;
    var res = Tasks.Tasks.list(listId, params);
    tasks = tasks.concat(res.items || []);
    pageToken = res.nextPageToken;
  } while (pageToken);
  return tasks;
}

// 原子跨清單搬移（任務 ID 不變），Quota Exceeded 等錯誤指數退避重試；沒權限（別的專案建立的任務）不重試
function weekdayFixMove_(fromListId, task, toListId) {
  for (var attempt = 1; ; attempt++) {
    try {
      Tasks.Tasks.move(fromListId, task.id, { destinationTasklist: toListId });
      Utilities.sleep(500);
      return true;
    } catch (e) {
      if (attempt >= 5 || /does not have permission/i.test(String(e))) {
        console.log('「' + task.title + '」搬移失敗：' + e.message);
        Utilities.sleep(2000);
        return false;
      }
      Utilities.sleep(Math.pow(2, attempt) * 1000);
    }
  }
}
