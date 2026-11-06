/**
 * all.html「✨ AI整理」：用 Claude API 整理禱告事項文字（去口語贅字、加標點、分段），不改原意。
 *
 * 設定（只要做一次）：
 *   1. 到 https://platform.claude.com 建 API key（有儲值的帳號）
 *   2. Apps Script 編輯器 →「專案設定」→「指令碼屬性」新增 CLAUDE_API_KEY = sk-ant-...
 *   3. 在編輯器手動執行一次 checkClaudeCredit()：會跳出授權（新增「連線到外部服務」權限），
 *      執行記錄會顯示 API key 是否可用、是否還有儲值
 *   4. 部署→管理部署→編輯→新版本（all.html 打的是部署網址，不發布新版本不會生效）
 *
 * 部署網址是公開的，為了避免被別人拿去燒額度：每段文字最多 AI_TIDY_MAX_CHARS 字、每天最多 AI_TIDY_DAILY_LIMIT 次。
 */
const AI_TIDY_MODEL = 'claude-opus-5-5';
const AI_TIDY_MAX_CHARS = 3000;
const AI_TIDY_DAILY_LIMIT = 100;

const AI_TIDY_SYSTEM = [
  '你是幫忙整理禱告事項文字的助手。使用者給你一段禱告事項（常是語音輸入、口語、沒有標點）。',
  '請用繁體中文（台灣用語）整理成通順、好讀、適合朗讀禱告的文字：',
  '- 補上正確標點、必要時分段或條列；',
  '- 刪掉口語贅字與重複（例如「就是」「那個」「啊」「哦」「呢」重複出現的部分）、修正明顯的語音辨識錯字；',
  '- 保留原意、所有人名、事件、細節與代禱重點，不要新增原文沒有的內容，也不要寫成禱告詞；',
  '- 長度可以比原文短，但重點不能漏。',
  '只輸出整理後的文字本身，不要任何前言、說明或引號。'
].join('\n');

function callClaude_(payload) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('CLAUDE_API_KEY');
  if (!apiKey) throw new Error('還沒設定 Claude API key（指令碼屬性 CLAUDE_API_KEY）');
  const resp = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2026-10-21',
      // 安全分類器擋下時由伺服器自動改用其他模型重試
      'anthropic-beta': 'server-side-fallback-2026-07-01'
    },
    payload: JSON.stringify(Object.assign({ fallbacks: 'default' }, payload)),
    muteHttpExceptions: true
  });
  const code = resp.getResponseCode();
  let data;
  try { data = JSON.parse(resp.getContentText()); } catch (e) { data = {}; }
  if (code !== 200) {
    const msg = (data.error && data.error.message) || resp.getContentText().slice(0, 300);
    if (/credit balance/i.test(msg)) throw new Error('Claude API 儲值不足，請到 platform.claude.com → Billing 儲值');
    if (code === 401) throw new Error('Claude API key 無效（401），請檢查指令碼屬性 CLAUDE_API_KEY');
    if (code === 429) throw new Error('Claude API 太忙或超過速率限制（429），稍後再試');
    throw new Error('Claude API 錯誤 ' + code + '：' + msg);
  }
  return data;
}

function aiTidyText(text) {
  text = String(text || '').trim();
  if (!text) throw new Error('沒有文字可以整理');
  if (text.length > AI_TIDY_MAX_CHARS) throw new Error('文字太長（超過 ' + AI_TIDY_MAX_CHARS + ' 字）');

  const props = PropertiesService.getScriptProperties();
  const today = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    let usage = {};
    try { usage = JSON.parse(props.getProperty('AI_TIDY_USAGE') || '{}'); } catch (e) {}
    if (usage.date !== today) usage = { date: today, count: 0 };
    if (usage.count >= AI_TIDY_DAILY_LIMIT) throw new Error('今天 AI 整理已達上限 ' + AI_TIDY_DAILY_LIMIT + ' 次');
    usage.count++;
    props.setProperty('AI_TIDY_USAGE', JSON.stringify(usage));
  } finally {
    lock.releaseLock();
  }

  const data = callClaude_({
    model: AI_TIDY_MODEL,
    max_tokens: 8000,
    output_config: { effort: 'low' },
    system: AI_TIDY_SYSTEM,
    messages: [{ role: 'user', content: text }]
  });
  if (data.stop_reason === 'refusal') throw new Error('Claude 拒絕處理這段文字');
  const out = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
  if (!out) throw new Error('Claude 沒有回傳文字');
  return { text: out, model: data.model, truncated: data.stop_reason === 'max_tokens' };
}

/**
 * 檢查 API key 與儲值：送一個最小的請求。Claude API 沒有查詢餘額的端點，
 * 餘額不足時請求會回 400「credit balance is too low」，用這個判斷。實際餘額數字要到 platform.claude.com → Billing 看。
 */
function checkClaudeCredit() {
  let result;
  try {
    const data = callClaude_({
      model: AI_TIDY_MODEL,
      max_tokens: 16,
      output_config: { effort: 'low' },
      messages: [{ role: 'user', content: '回覆 OK' }]
    });
    result = { ok: true, message: 'API key 可用、還有儲值（模型 ' + data.model + '）' };
  } catch (e) {
    result = { ok: false, message: e.message };
  }
  console.log(result.message);
  return result;
}
