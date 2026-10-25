/**
 * 接收「LINE通知記錄」APK 傳來的資料，加入 Google Tasks「預設清單」。
 * - 個人聊天：標題「1 好友：最新一則訊息」；一個好友一個任務。
 * - 群組聊天：標題「1 [群組]：寄件者：最新一則訊息」；一個群組一個任務（群組內所有人的訊息堆在一起，備註每行標示寄件者）。
 * - 清單裡已有該好友／群組「未完成」的任務就合併進去：備註累加每則訊息，標題更新為最新一則。
 *   把任務勾選完成後，下一則訊息會開新任務。
 * 需要啟用進階服務 Tasks API（左側「服務」＋ → Tasks API）。
 * 修改後要：部署 → 管理部署作業 → 編輯 → 版本：新版本（網址不變）。
 *
 * 一次性整理舊資料：在編輯器上方選函式 mergeExisting → 執行（會把同一個人的多個未完成任務合併成一個）。
 */
var PREFIX = '1 ';
var SEP = '：';
var MAX_NOTES = 7500;

function doPost(e) {
  var done = 0;
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
    var rows = JSON.parse(e.postData.contents).rows || [];
    var open = loadOpenTasks_();
    rows.forEach(function (r) {
      addMessage_(open, r);
      done++;
    });
    return out({ ok: true, count: done });
  } catch (err) {
    // done = 已成功處理的筆數，APK 會據此避免重試時重複建立
    return out({ ok: false, done: done, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

// 遇到頻率限制（Quota / Rate）就等一下再試；其他錯誤直接丟出
function retry_(fn, delays) {
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
function clean_(s) {
  return String(s || '')
    .replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
    .replace(/[\u00a0\u3000]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// 整理寄件者：LINE 群組的寄件者常是「群組名：人名」，一律只取最後一個冒號後面的人名；
// 沒有寄件者時，內文可能是「人名：訊息」。
// key 內不可含全形冒號（標題以第一個「：」切出 key），所以一律換成半形。
function normalize_(r) {
  var chat = clean_(r.chat);
  var sender = clean_(r.sender);
  var message = String(r.message || '');
  if (r.type === '群組') {
    var k = Math.max(sender.lastIndexOf('：'), sender.lastIndexOf(':'));
    if (k >= 0) sender = sender.substring(k + 1).trim();
    if (!sender || sender === chat) {
      sender = '';
      var m = message.match(/^([^:：\n]{1,30}?)\s*[:：]\s*([\s\S]+)$/);
      if (m) { sender = clean_(m[1]); message = m[2]; }
    }
  }
  var who = r.type === '群組' ? '[' + chat + ']' : (sender || chat);
  return { who: who.replace(/：/g, ':'), sender: r.type === '群組' ? sender : '', message: message };
}

function keyOf_(title) {
  if (!title || title.indexOf(PREFIX) !== 0) return null;
  var i = title.indexOf(SEP);
  if (i < 0) return null;
  return title.substring(PREFIX.length, i);
}

// 舊版的 key 是「[群組] 人名」；統一成「[群組]」，讓同一個群組的任務歸成一組
function groupKey_(key) {
  var m = /^(\[.*?\])(?: |$)/.exec(key);
  return m ? m[1] : key;
}

function listOpen_() {
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
function loadOpenTasks_() {
  var map = {};
  listOpen_().forEach(function (t) {
    var key = keyOf_(t.title);
    if (!key) return;
    t.__key = key;                                       // 原始 key（舊格式含人名）
    var gk = groupKey_(key);
    if (!map[gk]) map[gk] = t;
  });
  return map;
}

// 記住「群組／好友 → 任務 ID」。短時間連續進來的訊息，Tasks 清單可能還沒反映剛建立的任務，
// 只靠清單會重複建立；這裡用快取補上（6 小時內有效）。
function cacheKey_(who) {
  var d = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, who, Utilities.Charset.UTF_8);
  return 'task:' + Utilities.base64EncodeWebSafe(d);
}

function cacheGetTask_(who) {
  try {
    var id = CacheService.getScriptCache().get(cacheKey_(who));
    if (!id) return null;
    var t = Tasks.Tasks.get('@default', id);
    if (!t || t.deleted || t.status === 'completed') return null;
    t.__key = keyOf_(t.title) || who;
    return t;
  } catch (err) {
    return null;                                         // 任務已被刪除等：當作沒有
  }
}

function cachePutTask_(who, t) {
  try {
    CacheService.getScriptCache().put(cacheKey_(who), t.id, 21600);
  } catch (err) {}
}

function addMessage_(open, r) {
  var n = normalize_(r);
  var who = n.who;
  var body = n.sender ? n.sender + SEP + n.message : n.message;
  var title = (PREFIX + who + SEP + body).substring(0, 1000);
  var line = String(r.time).substring(5, 16) + ' ' + body;
  // 先用快取的任務 ID 抓「最新」內容（清單可能落後，備註會是舊的）；沒有才用清單
  var t = cacheGetTask_(who);
  var how = t ? '快取' : '';
  if (!t) {
    t = open[who];
    if (t) how = '清單';
  }
  console.log('收到 ' + JSON.stringify({ chat: r.chat, sender: r.sender, who: who,
    比對: how || '新建', 清單任務數: Object.keys(open).length }));
  if (t) {
    var notes = t.notes;
    if (who.charAt(0) === '[' && t.__key && t.__key !== who) {   // 併入舊格式任務：先補寄件者
      var p = parseTask_(t, t.__key, who);
      notes = p.header + '\n' + p.lines.join('\n');
    }
    open[who] = retry_(function () {
      return Tasks.Tasks.patch(
        { title: title, notes: appendLine_(notes, line) }, '@default', t.id);
    }, [1000, 3000]);
  } else {
    var header = '聊天室：' + r.chat + '（' + r.type + '）';
    open[who] = retry_(function () {
      return Tasks.Tasks.insert(
        { title: title, notes: header + '\n' + line }, '@default');
    }, [1000, 3000]);
  }
  cachePutTask_(who, open[who]);
}

// 保留第一行（標頭），超過長度就丟最舊的訊息
function appendLine_(notes, line) {
  var lines = (notes || '').split('\n');
  lines.push(line);
  while (lines.join('\n').length > MAX_NOTES && lines.length > 2) lines.splice(1, 1);
  return lines.join('\n');
}

// 讀出任務備註：回傳 {header, lines}。
// 舊版（以「[群組] 人名」為 key，或寄件者只出現在標題）建立的群組任務，備註沒有寄件者，這裡補上。
function parseTask_(t, key, gk) {
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
      var rest = t.title.substring(t.title.indexOf(SEP) + 1);
      var j = rest.indexOf(SEP);
      if (stamped.length === 1 && j > 0) {
        var after = rest.substring(j + 1);
        if (stamped[0].substring(12).indexOf(after.substring(0, Math.min(10, after.length))) === 0) {
          person = rest.substring(0, j).trim();
        }
      }
    }
    if (person) {
      lines = lines.map(function (l) { return prefixLine_(l, person + SEP); });
    }
  }
  return { header: header, lines: lines };
}

// 在「MM-dd HH:mm 」時間後面插入寄件者（續行不加）
function prefixLine_(line, prefix) {
  var m = /^(\d\d-\d\d \d\d:\d\d )([\s\S]*)$/.exec(line);
  return m ? m[1] + prefix + m[2] : line;
}

/**
 * 一次性：把同一個好友／同一個群組的多個未完成任務合併成一個（保留最新的一個，其餘刪除）。
 * 群組內不同人的舊任務也會合併，並在備註每行補上寄件者。
 * 可重複執行：訊息會去重；遇到頻率限制會自動等待重試，若仍失敗，等幾分鐘再執行一次即可接續。
 */
function mergeExisting() {
  var groups = {};
  listOpen_().forEach(function (t) {
    var key = keyOf_(t.title);
    if (!key) return;
    var gk = groupKey_(key);
    (groups[gk] = groups[gk] || []).push({ t: t, key: key });
  });
  var WAIT = [5000, 15000, 30000, 60000];
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
      var p = parseTask_(item.t, item.key, gk);
      header = header || p.header;
      p.lines.forEach(add);
    });
    while ((header + '\n' + lines.join('\n')).length > MAX_NOTES && lines.length > 1) lines.shift();
    var keep = g[0];                                     // 清單最上面＝最新
    var upd = { notes: header + '\n' + lines.join('\n') };
    if (isGroup && keep.key !== gk) {                    // 標題改成新格式「1 [群組]：寄件者：訊息」
      var rest = keep.t.title.substring(keep.t.title.indexOf(SEP) + 1);
      var kp = keep.key.substring(gk.length).trim();
      upd.title = (PREFIX + gk + SEP + (kp && kp !== chatName ? kp + SEP : '') + rest).substring(0, 1000);
    }
    retry_(function () {
      return Tasks.Tasks.patch(upd, '@default', keep.t.id);
    }, WAIT);
    g.slice(1).forEach(function (item) {
      retry_(function () { Tasks.Tasks.remove('@default', item.t.id); }, WAIT);
      Utilities.sleep(700);                              // 放慢速度，避免觸發限制
    });
    console.log('已合併：' + gk + '（' + g.length + ' → 1）');
  });
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}