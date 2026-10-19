/**
 * LINE通知記錄（linelog App，Davycmg/APK 的 linelog 模組）的接收端，原本是獨立的 Apps Script 專案，
 * 2026-10 併進禱告卡專案：同一個專案建立的 Google Tasks 任務，禱告卡的完成／改標題／移到工作日才改得動
 * （由其他專案建立的任務，這個專案修改時會收到「The caller does not have permission」）。
 *
 * 接收 App 傳來的資料，加入 Google Tasks「預設清單」：
 * - 標題：「1 寄件者：最新一則訊息」
 * - 同一個人（群組則為「[群組] 寄件者」）若在清單裡已有「未完成」的任務，就合併進去：
 *   備註累加每則訊息，標題更新為最新一則。把任務勾選完成後，下一則訊息會開新任務。
 *
 * 安全：禱告卡的部署網址公開寫在 GitHub Pages 頁面裡，所以 POST 必須帶 ?key=金鑰 才會處理。
 * 第一次使用：在編輯器執行 setupLinelogKey()，執行記錄會印出完整網址，貼進 App 即可。
 */
var LINELOG_PREFIX = '1 ';
var LINELOG_SEP = '：';
var LINELOG_MAX_NOTES = 7500;
var LINELOG_KEY_PROP = 'LINELOG_KEY';

function doPost(e) {
  var expectedKey = PropertiesService.getScriptProperties().getProperty(LINELOG_KEY_PROP);
  if (!expectedKey) return linelogOut_({ ok: false, done: 0, error: '尚未設定金鑰，請在 Apps Script 執行 setupLinelogKey()' });
  if (!e || !e.parameter || e.parameter.key !== expectedKey) return linelogOut_({ ok: false, done: 0, error: '金鑰錯誤' });

  var done = 0;
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
    var rows = JSON.parse(e.postData.contents).rows || [];
    var open = linelogLoadOpenTasks_();
    rows.forEach(function (r) {
      linelogAddMessage_(open, r);
      done++;
    });
    return linelogOut_({ ok: true, count: done });
  } catch (err) {
    // done = 已成功處理的筆數，App 會據此避免重試時重複建立
    return linelogOut_({ ok: false, done: done, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

/**
 * 手動執行一次：產生金鑰存到指令碼屬性，並印出要貼進 App 的完整網址。
 * 已經有金鑰時沿用（不會讓已設定好的 App 失效）；要換金鑰就先到「專案設定 → 指令碼屬性」刪掉 LINELOG_KEY。
 */
function setupLinelogKey() {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty(LINELOG_KEY_PROP);
  if (!key) {
    key = Utilities.getUuid().replace(/-/g, '');
    props.setProperty(LINELOG_KEY_PROP, key);
  }
  var url = ScriptApp.getService().getUrl();
  console.log('貼進 LINE通知記錄 App 的網址（等同寫入密碼，請勿外流）：\n' + url + '?key=' + key);
  console.log('如果上面的網址是 /dev 結尾，請改用「部署 → 管理部署作業」裡網頁應用程式的 /exec 網址，後面加上 ?key=' + key);
}

// 遇到頻率限制（Quota / Rate）就等一下再試；其他錯誤直接丟出
function linelogRetry_(fn, delays) {
  for (var i = 0; ; i++) {
    try {
      return fn();
    } catch (err) {
      var m = String(err);
      if (i >= delays.length || !/quota|rate|limit|backend/i.test(m)) throw err;
      Utilities.sleep(delays[i]);
    }
  }
}

function linelogWhoOf_(r) {
  return r.type === '群組' ? '[' + r.chat + '] ' + r.sender : r.sender;
}

function linelogKeyOf_(title) {
  if (!title || title.indexOf(LINELOG_PREFIX) !== 0) return null;
  var i = title.indexOf(LINELOG_SEP);
  if (i < 0) return null;
  return title.substring(LINELOG_PREFIX.length, i);
}

function linelogListOpen_() {
  var all = [];
  var token;
  do {
    var opts = { showCompleted: false, showHidden: false, maxResults: 100 };
    if (token) opts.pageToken = token;
    var res = Tasks.Tasks.list('@default', opts);
    (res.items || []).forEach(function (t) { all.push(t); });
    token = res.nextPageToken;
  } while (token);
  return all;
}

// key -> 最新（清單最上面）的未完成任務
function linelogLoadOpenTasks_() {
  var map = {};
  linelogListOpen_().forEach(function (t) {
    var key = linelogKeyOf_(t.title);
    if (key && !map[key]) map[key] = t;
  });
  return map;
}

function linelogAddMessage_(open, r) {
  var who = linelogWhoOf_(r);
  var title = (LINELOG_PREFIX + who + LINELOG_SEP + r.message).substring(0, 1000);
  var line = String(r.time).substring(5, 16) + ' ' + r.message;
  var t = open[who];
  if (t) {
    try {
      open[who] = linelogRetry_(function () {
        return Tasks.Tasks.patch(
          { title: title, notes: linelogAppendLine_(t.notes, line) }, '@default', t.id);
      }, [1000, 3000]);
      return;
    } catch (err) {
      // 舊的 linelog 專案建立的任務，這個專案改不動：改成開一個新任務（之後的訊息就會累加到新任務）
      if (String(err).indexOf('permission') === -1) throw err;
    }
  }
  var header = '聊天室：' + r.chat + '（' + r.type + '）';
  open[who] = linelogRetry_(function () {
    return Tasks.Tasks.insert(
      { title: title, notes: header + '\n' + line }, '@default');
  }, [1000, 3000]);
}

// 保留第一行（標頭），超過長度就丟最舊的訊息
function linelogAppendLine_(notes, line) {
  var lines = (notes || '').split('\n');
  lines.push(line);
  while (lines.join('\n').length > LINELOG_MAX_NOTES && lines.length > 2) lines.splice(1, 1);
  return lines.join('\n');
}

function linelogOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
