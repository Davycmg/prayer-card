// 固定指定試算表 ID，避免 getActiveSpreadsheet() 在時間觸發器中
// 因「快取記住的上次分頁已被刪除/重建」而找不到分頁的問題
const SPREADSHEET_ID = "1m-MGdv2U7HIJxRftUXs6GxRX-WLj-NTm93DVROoTSd0";

function onFormSubmit(e) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName("表單回覆 1");
  const row = e ? e.range.getRow() : sheet.getLastRow();
  
  if (row < 2) return; 

  const timestamp = sheet.getRange(row, 1).getValue(); // A欄：時間戳記
  const frequency = sheet.getRange(row, 3).getValue(); // C欄：週期
  let currentDateValue = sheet.getRange(row, 6).getValue(); // F欄：本次代禱

  // 【邏輯1】如果 F 欄是空白的，用 A 欄時間戳記 + 1 天來補上
  if (!currentDateValue) {
    if (!timestamp) return; // 如果連時間戳記都沒有，就跳過
    
    // 將時間戳記轉換為日期，並加 1 天
    let fallbackDate = new Date(timestamp);
    fallbackDate.setDate(fallbackDate.getDate() + 1); 
    
    // 自動把這個日期補寫入 F 欄
    sheet.getRange(row, 6).setValue(fallbackDate);
    sheet.getRange(row, 6).setNumberFormat("yyyy-MM-dd HH:mm:ss");
    
    // 將這個新日期當作接下來計算的基準
    currentDateValue = fallbackDate; 
  }

  // 強制將 F 欄的內容轉換為程式看得懂的日期物件
  let currentDate = new Date(currentDateValue);

  // 檢查轉換後是不是一個「有效的日期」
  if (isNaN(currentDate.getTime())) return;

  // 複製一份當前日期來計算下次日期
  let nextDate = new Date(currentDate.getTime());
  const now = new Date(); // 取得當前的系統時間

  // 【邏輯2】根據 C 欄的週期計算下次代禱日期
  // 加上 do...while 迴圈防呆：如果計算出來的日期在過去，就持續累加直到超越當前時間
  do {
    switch (frequency) {
      case "每天": nextDate.setDate(nextDate.getDate() + 1); break;
      case "每兩天": nextDate.setDate(nextDate.getDate() + 2); break;
      case "每三天": nextDate.setDate(nextDate.getDate() + 3); break;
      case "每四天": nextDate.setDate(nextDate.getDate() + 4); break;
      case "每五天": nextDate.setDate(nextDate.getDate() + 5); break;
      case "每週": nextDate.setDate(nextDate.getDate() + 7); break;
      case "每兩週": nextDate.setDate(nextDate.getDate() + 14); break;
      case "每月": nextDate.setMonth(nextDate.getMonth() + 1); break;
      case "每兩個月": nextDate.setMonth(nextDate.getMonth() + 2); break;
      case "每季": nextDate.setMonth(nextDate.getMonth() + 3); break;
      case "每半年": nextDate.setMonth(nextDate.getMonth() + 6); break;
      case "每年": nextDate.setFullYear(nextDate.getFullYear() + 1); break;
      default: return; // 如果沒有符合的週期，則不寫入
    }
  } while (nextDate < now); // 當計算出的時間仍小於現在，就繼續累加

  // 將計算好的下次代禱日期寫入 G 欄
  sheet.getRange(row, 7).setValue(nextDate);
  // 設定 G 欄的日期格式
  sheet.getRange(row, 7).setNumberFormat("yyyy-MM-dd HH:mm:ss");
}

// 批次處理所有資料的函式 (也是每天半夜要執行的主程式)
function processAllExistingRows() {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName("表單回覆 1");
  const lastRow = sheet.getLastRow();
  
  if (lastRow < 2) return;

  const errors = []; // 收集失敗的列號與錯誤訊息，方便最後統一查看
  
  for (let r = 2; r <= lastRow; r++) {
    try {
      let e = { range: sheet.getRange(r, 1) };
      onFormSubmit(e);
    } catch (err) {
      const msg = `第 ${r} 列處理失敗：${err.message}`;
      console.error(msg);
      errors.push(msg);
    }
  }

  if (errors.length > 0) {
    console.error(`本次執行共有 ${errors.length} 列失敗：\n` + errors.join("\n"));
  } else {
    console.log("✅ 所有列皆處理成功。");
  }
}

// =========================================
// 觸發條件設定區 (每天 23:00~24:00 自動執行)
// =========================================
function setupDailyTrigger() {
  const functionName = 'processAllExistingRows';
  
  // 1. 先清除舊的觸發條件，避免重複建立導致一天跑好幾次
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === functionName) {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  
  // 2. 建立新的每日觸發條件
  // atHour(23) 代表在 23:00 ~ 24:00 之間執行
  ScriptApp.newTrigger(functionName)
    .timeBased()
    .everyDays(1)
    .atHour(23)
    .create();
    
  console.log("✅ 每日觸發條件已設定完成！系統將於每天 23:00~24:00 之間自動執行。");
}

// 一次性函式：移除 processAllExistingRows 的每日觸發條件。
// 在 Apps Script 編輯器手動執行一次即可，執行完可以直接刪掉這個函式。
function removeProcessAllExistingRowsTrigger() {
  const functionName = 'processAllExistingRows';
  const triggers = ScriptApp.getProjectTriggers();
  let removed = 0;

  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === functionName) {
      ScriptApp.deleteTrigger(trigger);
      removed++;
    }
  });

  console.log(removed > 0
    ? `✅ 已移除 ${removed} 個 processAllExistingRows 觸發條件。`
    : "沒有找到 processAllExistingRows 的觸發條件，可能已經被移除過了。");
}