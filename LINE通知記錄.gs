/**
 * LINE通知記錄（linelog App，Davycmg/APK 的 linelog 模組）的接收端，原本是獨立的 Apps Script 專案，
 * 2026-10 併進禱告卡專案：同一個專案建立的 Google Tasks 任務，禱告卡的完成／改標題／移到工作日才改得動
 * （由其他專案建立的任務，這個專案修改時會收到「The caller does not have permission」）。
 *
 * 接收 App 傳來的資料，加入 Google Tasks「預設清單」：
 * - 個人聊天：標題「1 好友：最新一則訊息」；一個好友一個任務。
 * - 群組聊天：標題「1 [群組]：寄件者：最新一則訊息」；一個群組一個任務（備註每行標示寄件者）。
 * - 清單裡已有該好友／群組「未完成」的任務就合併進去：備註累加每則訊息，標題更新為最新一則。
 *   把任務勾選完成後，下一則訊息會開新任務。
 * （以上邏輯 2026-10-25 從舊的獨立 linelog 專案（linelog/）搬過來，那邊後來改得比這裡新）
 *
 * all.html「合併 LINE 通知待辦」按鈕 → doGet action mergeLinelogTasks → linelogMergeExisting()：
 * 把同一個好友／群組的多個未完成任務合併成一個。
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

// 清掉看不見的方向標記／零寬字元，空白一律壓成單一半形空格
function linelogClean_(s) {
  return String(s || '')
    .replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
    .replace(/[\u00a0\u3000]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// 整理寄件者：LINE 群組的寄件者常是「群組名：人名」，一律只取最後一個冒號後面的人名；
// 沒有寄件者時，內文可能是「人名：訊息」。
// key 內不可含全形冒號（標題以第一個「：」切出 key），所以一律換成半形。
function linelogNormalize_(r) {
  var chat = linelogClean_(r.chat);
  var sender = linelogClean_(r.sender);
  var message = String(r.message || '');
  if (r.type === '群組') {
    var k = Math.max(sender.lastIndexOf('：'), sender.lastIndexOf(':'));
    if (k >= 0) sender = sender.substring(k + 1).trim();
    if (!sender || sender === chat) {
      sender = '';
      var m = message.match(/^([^:：\n]{1,30}?)\s*[:：]\s*([\s\S]+)$/);
      if (m) { sender = linelogClean_(m[1]); message = m[2]; }
    }
  }
  var who = r.type === '群組' ? '[' + chat + ']' : (sender || chat);
  return { who: who.replace(/：/g, ':'), sender: r.type === '群組' ? sender : '', message: message };
}

function linelogKeyOf_(title) {
  if (!title || title.indexOf(LINELOG_PREFIX) !== 0) return null;
  var i = title.indexOf(LINELOG_SEP);
  if (i < 0) return null;
  return title.substring(LINELOG_PREFIX.length, i);
}

// 舊版的 key 是「[群組] 人名」；統一成「[群組]」，讓同一個群組的任務歸成一組
function linelogGroupKey_(key) {
  var m = /^(\[.*?\])(?: |$)/.exec(key);
  return m ? m[1] : key;
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
    if (!key) return;
    t.__key = key;                                       // 原始 key（舊格式含人名）
    var gk = linelogGroupKey_(key);
    if (!map[gk]) map[gk] = t;
  });
  return map;
}

// 記住「群組／好友 → 任務 ID」。短時間連續進來的訊息，Tasks 清單可能還沒反映剛建立的任務，
// 只靠清單會重複建立；這裡用快取補上（6 小時內有效）。
function linelogCacheKey_(who) {
  var d = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, who, Utilities.Charset.UTF_8);
  return 'task:' + Utilities.base64EncodeWebSafe(d);
}

function linelogCacheGetTask_(who) {
  try {
    var id = CacheService.getScriptCache().get(linelogCacheKey_(who));
    if (!id) return null;
    var t = Tasks.Tasks.get('@default', id);
    if (!t || t.deleted || t.status === 'completed') return null;
    t.__key = linelogKeyOf_(t.title) || who;
    return t;
  } catch (err) {
    return null;                                         // 任務已被刪除等：當作沒有
  }
}

function linelogCachePutTask_(who, t) {
  try {
    CacheService.getScriptCache().put(linelogCacheKey_(who), t.id, 21600);
  } catch (err) {}
}

function linelogAddMessage_(open, r) {
  var n = linelogNormalize_(r);
  var who = n.who;
  var body = n.sender ? n.sender + LINELOG_SEP + n.message : n.message;
  var title = (LINELOG_PREFIX + who + LINELOG_SEP + body).substring(0, 1000);
  var line = String(r.time).substring(5, 16) + ' ' + body;
  // 先用快取的任務 ID 抓「最新」內容（清單可能落後，備註會是舊的）；沒有才用清單
  var t = linelogCacheGetTask_(who);
  var how = t ? '快取' : '';
  if (!t) {
    t = open[who];
    if (t) how = '清單';
  }
  console.log('收到 ' + JSON.stringify({ chat: r.chat, sender: r.sender, who: who,
    比對: how || '新建', 清單任務數: Object.keys(open).length }));
  var patched = false;
  if (t) {
    var notes = t.notes;
    if (who.charAt(0) === '[' && t.__key && t.__key !== who) {   // 併入舊格式任務：先補寄件者
      var p = linelogParseTask_(t, t.__key, who);
      notes = p.header + '\n' + p.lines.join('\n');
    }
    try {
      open[who] = linelogRetry_(function () {
        return Tasks.Tasks.patch(
          { title: title, notes: linelogAppendLine_(notes, line) }, '@default', t.id);
      }, [1000, 3000]);
      patched = true;
    } catch (err) {
      // 舊的 linelog 專案建立的任務，這個專案改不動：改成開一個新任務（之後的訊息就會累加到新任務）
      if (!linelogIsNoPermission_(err)) throw err;
    }
  }
  if (!patched) {
    var header = '聊天室：' + r.chat + '（' + r.type + '）';
    open[who] = linelogRetry_(function () {
      return Tasks.Tasks.insert(
        { title: title, notes: header + '\n' + line }, '@default');
    }, [1000, 3000]);
  }
  linelogCachePutTask_(who, open[who]);
}

// 保留第一行（標頭），超過長度就丟最舊的訊息
function linelogAppendLine_(notes, line) {
  var lines = (notes || '').split('\n');
  lines.push(line);
  while (lines.join('\n').length > LINELOG_MAX_NOTES && lines.length > 2) lines.splice(1, 1);
  return lines.join('\n');
}

// 讀出任務備註：回傳 {header, lines}。
// 舊版（以「[群組] 人名」為 key，或寄件者只出現在標題）建立的群組任務，備註沒有寄件者，這裡補上。
function linelogParseTask_(t, key, gk) {
  var isGroup = gk.charAt(0) === '[';
  var chatName = isGroup ? gk.slice(1, -1) : '';
  var n = t.notes || '';
  var header;
  var lines;
  if (n.indexOf('聊天室：') === 0) {                     // 新格式：第一行是聊天室
    var parts = n.split('\n');
    header = parts[0];
    lines = parts.slice(1);
  } else {                                               // 最舊格式：時間／聊天室／空行／訊息
    var tm = n.match(/時間：\d{4}-(\d\d-\d\d \d\d:\d\d)/);
    var ch = n.match(/聊天室：[^\n]*/);
    var i = n.indexOf('\n\n');
    var msg = i >= 0 ? n.substring(i + 2) : t.title;
    header = ch ? ch[0] : '聊天室：' + gk;
    lines = [(tm ? tm[1] : '') + ' ' + msg];
  }
  if (isGroup && key !== gk) {
    var person = key.substring(gk.length).trim();
    if (person === chatName) person = '';
    if (!person) {                                       // 寄件者在標題：「…群組名：人名：訊息」
      var stamped = lines.filter(function (l) { return /^\d\d-\d\d \d\d:\d\d /.test(l); });
      var rest = t.title.substring(t.title.indexOf(LINELOG_SEP) + 1);
      var j = rest.indexOf(LINELOG_SEP);
      if (stamped.length === 1 && j > 0) {
        var after = rest.substring(j + 1);
        if (stamped[0].substring(12).indexOf(after.substring(0, Math.min(10, after.length))) === 0) {
          person = rest.substring(0, j).trim();
        }
      }
    }
    if (person) {
      lines = lines.map(function (l) { return linelogPrefixLine_(l, person + LINELOG_SEP); });
    }
  }
  return { header: header, lines: lines };
}

// 在「MM-dd HH:mm 」時間後面插入寄件者（續行不加）
function linelogPrefixLine_(line, prefix) {
  var m = /^(\d\d-\d\d \d\d:\d\d )([\s\S]*)$/.exec(line);
  return m ? m[1] + prefix + m[2] : line;
}

/**
 * all.html 按鈕／編輯器手動執行：把同一個好友／同一個群組的多個未完成任務合併成一個（保留最新的一個，其餘刪除）。
 * 群組內不同人的舊任務也會合併，並在備註每行補上寄件者。
 * 可重複執行：訊息會去重；遇到頻率限制會自動等待重試，若仍失敗，等幾分鐘再執行一次即可接續。
 */
function linelogMergeExisting() {
  var groups = {};
  linelogListOpen_().forEach(function (t) {
    var key = linelogKeyOf_(t.title);
    if (!key) return;
    var gk = linelogGroupKey_(key);
    (groups[gk] = groups[gk] || []).push({ t: t, key: key });
  });
  var WAIT = [5000, 15000, 30000, 60000];
  var merged = [];
  var skipped = [];
  Object.keys(groups).forEach(function (gk) {
    var g = groups[gk];
    if (g.length < 2) return;
    var isGroup = gk.charAt(0) === '[';
    var chatName = isGroup ? gk.slice(1, -1) : '';
    var header = null;
    var lines = [];
    var seen = {};
    function add(line) {
      if (!seen[line]) { seen[line] = true; lines.push(line); }
    }
    g.slice().reverse().forEach(function (item) {        // 舊 → 新
      var p = linelogParseTask_(item.t, item.key, gk);
      header = header || p.header;
      p.lines.forEach(add);
    });
    while ((header + '\n' + lines.join('\n')).length > LINELOG_MAX_NOTES && lines.length > 1) lines.shift();
    // 清單最上面＝最新，優先保留它；但由其他 Apps Script 專案（例如 prayer-card）建立的任務，
    // 這個專案改不動（The caller does not have permission），就往下找第一個改得動的
    var keep = null;
    for (var i = 0; i < g.length && !keep; i++) {
      var cand = g[i];
      var upd = { notes: header + '\n' + lines.join('\n') };
      if (isGroup && cand.key !== gk) {                  // 標題改成新格式「1 [群組]：寄件者：訊息」
        var rest = cand.t.title.substring(cand.t.title.indexOf(LINELOG_SEP) + 1);
        var kp = cand.key.substring(gk.length).trim();
        upd.title = (LINELOG_PREFIX + gk + LINELOG_SEP + (kp && kp !== chatName ? kp + LINELOG_SEP : '') + rest).substring(0, 1000);
      }
      try {
        linelogRetry_(function () {
          return Tasks.Tasks.patch(upd, '@default', cand.t.id);
        }, WAIT);
        keep = cand;
      } catch (err) {
        if (!linelogIsNoPermission_(err)) throw err;
      }
    }
    if (!keep) {
      console.log('略過（全部都是其他專案建立的任務）：' + gk);
      skipped.push({ key: gk, count: g.length });
      return;
    }
    var left = 0;
    g.forEach(function (item) {
      if (item === keep) return;
      try {
        linelogRetry_(function () { Tasks.Tasks.remove('@default', item.t.id); }, WAIT);
      } catch (err) {
        if (!linelogIsNoPermission_(err)) throw err;
        left++;                                          // 刪不掉的留著（內容已併進保留的任務），請手動完成
      }
      Utilities.sleep(700);                              // 放慢速度，避免觸發限制
    });
    console.log('已合併：' + gk + '（' + g.length + ' → ' + (1 + left) + '）');
    merged.push({ key: gk, count: g.length, left: left });
  });
  return { ok: true, merged: merged, skipped: skipped };
}

// all.html 按鈕（doGet action mergeLinelogTasks）：跟 doPost 共用鎖，避免合併時剛好有新訊息進來改同一批任務
function mergeLinelogTasks() {
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    return linelogMergeExisting();
  } finally {
    lock.releaseLock();
  }
}

function linelogIsNoPermission_(err) {
  return /does not have permission/i.test(String(err));
}

function linelogOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
