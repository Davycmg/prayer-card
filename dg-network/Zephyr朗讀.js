// ========== AllCard.html（?view=all）朗讀用：Gemini TTS「Zephyr」語音 ==========
// 瀏覽器內建的 speechSynthesis 沒有 Zephyr，這是 Gemini API 的預設語音之一，
// 所以由後端呼叫 Gemini TTS 產生語音（24kHz、16-bit、單聲道 PCM，base64），前端包成 WAV 播放。
//
// 設定：指令碼屬性 GEMINI_API_KEY（到 aistudio.google.com 建 API key，不進 repo）。
// 第一次要在編輯器手動執行 checkZephyrTts() 授權「連線到外部服務」並確認 key 可用，再發布新版本。
// 可選：指令碼屬性 GEMINI_TTS_MODEL 覆寫模型名稱（預設 gemini-2.5-flash-preview-tts）。
//
// 部署網址是公開的（ANYONE_ANONYMOUS），所以限制每段長度與每天次數，避免被濫用燒 API 額度。

const ZEPHYR_VOICE_NAME = 'Zephyr';
// 可以指定的 Gemini TTS 預設語音（試聽／之後換聲音用；不在清單裡的一律用 Zephyr）
const GEMINI_TTS_VOICES = [
  'Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda', 'Orus', 'Aoede', 'Callirrhoe', 'Autonoe',
  'Enceladus', 'Iapetus', 'Umbriel', 'Algieba', 'Despina', 'Erinome', 'Algenib', 'Rasalgethi', 'Laomedeia', 'Achernar',
  'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird', 'Zubenelgenubi', 'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat'
];
// 可以指定的模型（白名單，避免公開網址被拿去打別的模型）
const GEMINI_TTS_MODELS = ['gemini-2.5-flash-preview-tts', 'gemini-2.5-pro-preview-tts'];
const ZEPHYR_DEFAULT_MODEL = 'gemini-2.5-flash-preview-tts';
const ZEPHYR_MAX_CHARS = 2000;
const ZEPHYR_DAILY_LIMIT = 1000;

// 用 POST（text/plain）送文字：備註可能很長，放在 GET 網址參數會超過長度限制
function doPost(e) {
  let result;
  try {
    const body = JSON.parse((e.postData && e.postData.contents) || '{}');
    if (body.action === 'tts') {
      result = zephyrTts_(body.text, body.voice, body.model);
    } else {
      result = { error: 'unknown action: ' + body.action };
    }
  } catch (err) {
    result = { error: err.message || String(err) };
  }
  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function zephyrTts_(text, voice, modelOverride) {
  text = String(text || '').trim();
  if (!text) throw new Error('沒有文字可以朗讀');
  if (text.length > ZEPHYR_MAX_CHARS) text = text.slice(0, ZEPHYR_MAX_CHARS);

  const props = PropertiesService.getScriptProperties();
  const apiKey = props.getProperty('GEMINI_API_KEY');
  if (!apiKey) throw new Error('還沒設定 GEMINI_API_KEY（指令碼屬性）');
  zephyrCountUsage_();

  const model = GEMINI_TTS_MODELS.indexOf(modelOverride) !== -1
    ? modelOverride
    : (props.getProperty('GEMINI_TTS_MODEL') || ZEPHYR_DEFAULT_MODEL);
  const voiceName = GEMINI_TTS_VOICES.indexOf(voice) !== -1 ? voice : ZEPHYR_VOICE_NAME;
  // TTS 模型遇到很短的文字（例如「測試」「1」）會當成提問、想回文字而回 400
  // （Model tried to generate text…）。前面加明確的朗讀指示（指示本身不會被唸出來），
  // 而且這個錯誤是隨機的，遇到就再試，最多 3 次。
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return zephyrCallGemini_(apiKey, model, text, voiceName);
    } catch (err) {
      lastErr = err;
      if (!/should only be used for TTS|generate text/i.test(err.message)) throw err;
    }
  }
  throw lastErr;
}

function zephyrCallGemini_(apiKey, model, text, voiceName) {
  const prompt = 'Read the following Traditional Chinese text aloud, word for word, in a warm and calm voice. '
    + 'Do not add, answer, or translate anything:\n' + text;
  const res = UrlFetchApp.fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent',
    {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-goog-api-key': apiKey },
      muteHttpExceptions: true,
      payload: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceName } } }
        }
      })
    }
  );
  const code = res.getResponseCode();
  const data = JSON.parse(res.getContentText() || '{}');
  if (code !== 200) {
    throw new Error('Gemini TTS 錯誤 ' + code + '：' + ((data.error && data.error.message) || res.getContentText().slice(0, 200)));
  }
  const parts = (((data.candidates || [])[0] || {}).content || {}).parts || [];
  const audioPart = parts.find(p => p.inlineData && p.inlineData.data);
  if (!audioPart) throw new Error('Gemini TTS 沒有回傳語音');
  const mime = audioPart.inlineData.mimeType || '';
  const rateMatch = mime.match(/rate=(\d+)/);
  return { audio: audioPart.inlineData.data, sampleRate: rateMatch ? Number(rateMatch[1]) : 24000 };
}

function zephyrCountUsage_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const props = PropertiesService.getScriptProperties();
    const today = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');
    let usage = {};
    try { usage = JSON.parse(props.getProperty('ZEPHYR_TTS_USAGE') || '{}'); } catch (err) { usage = {}; }
    const count = usage.date === today ? usage.count : 0;
    if (count >= ZEPHYR_DAILY_LIMIT) throw new Error('今天 Zephyr 朗讀次數已達上限（' + ZEPHYR_DAILY_LIMIT + ' 次）');
    props.setProperty('ZEPHYR_TTS_USAGE', JSON.stringify({ date: today, count: count + 1 }));
  } finally {
    lock.releaseLock();
  }
}

// 在編輯器手動執行：授權 UrlFetchApp，並確認 GEMINI_API_KEY 可以產生 Zephyr 語音
function checkZephyrTts() {
  const r = zephyrTts_('平安，這是 Zephyr 語音測試。');
  Logger.log('OK，取得語音 ' + r.audio.length + ' 字元（base64），取樣率 ' + r.sampleRate);
}
