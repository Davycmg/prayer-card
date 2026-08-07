/**
 * 每日檢查、更新並發送禱告報表的主程式
 * 修正點：採用字串比對日期，避免時區與時分秒造成的漏單問題。
 * 欄位對應：A時間戳記 B姓名 C週期 D備註 E電子郵件地址 F本次代禱 G下次代禱
 */
function checkAndSendTodayPrayers() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("表單回覆 1");
  
  if (!sheet) {
    console.error("找不到名為 '表單回覆 1' 的工作表，請確認名稱是否正確。");
    return;
  }
  
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  
  // 1. 取得今天的日期字串 (格式如 "2026-07-02")
  const todayStr = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), "yyyy-MM-dd");
  
  // 用來存放今天代禱項目的陣列
  let todayPrayers = [];
  
  // 2. 逐列檢查資料
  for (let row = 2; row <= lastRow; row++) {
    let frequency = sheet.getRange(row, 3).getValue(); // C欄：週期
    let eValue = sheet.getRange(row, 6).getValue();    // F欄：本次代禱
    let fValue = sheet.getRange(row, 7).getValue();    // G欄：下次代禱
    
    let isToday = false;
    
    // 檢查 G 欄（下次代禱）是否為今天
    if (fValue instanceof Date) {
      let fValueStr = Utilities.formatDate(fValue, ss.getSpreadsheetTimeZone(), "yyyy-MM-dd");
      if (fValueStr === todayStr) {
        isToday = true;
      }
    }
    
    // 檢查 F 欄（本次代禱）是否為今天 (如果 G 欄不是，再檢查 F 欄)
    if (!isToday && eValue instanceof Date) {
      let eValueStr = Utilities.formatDate(eValue, ss.getSpreadsheetTimeZone(), "yyyy-MM-dd");
      if (eValueStr === todayStr) {
        isToday = true;
      }
    }
    
    // 如果符合今天的日期，就抓取該列資料
    if (isToday) {
      let name = sheet.getRange(row, 2).getValue();    // B欄：姓名
      let content = sheet.getRange(row, 4).getValue(); // D欄：禱告內容/備註
      
      todayPrayers.push({
        row: row,
        name: name,
        frequency: frequency,
        content: content
      });
    }
  }
  
  // 3. 根據有沒有找到人，執行發送邏輯
  if (todayPrayers.length > 0) {
    sendPrayerReportEmail(todayPrayers); 
    console.log(`✅ 成功處理今天的代禱報表，共 ${todayPrayers.length} 人。`);
  } else {
    sendEmptyReportEmail();
    console.log("ℹ️ 今天沒有需要處理的代禱人員。");
  }
}

/**
 * 完整發送報表的函式 (透過 Email 發送)
 */
function sendPrayerReportEmail(prayers) {
  const RECEIVER_EMAIL = "528david@gmail.com"; 

  const todayStr = Utilities.formatDate(new Date(), "GMT+8", "yyyy-MM-dd");
  
  // 1. 撰寫主旨
  const subject = `📋 【今日禱告網絡報表】 - ${todayStr} (${prayers.length}人)`;
  
  // 2. 組合信件內文 (純文字格式)
  let body = `平安！以下是今日 (${todayStr}) 排定的代禱網絡報表：\n\n`;
  body += `👥 今日代禱總人數：${prayers.length} 人\n`;
  body += `==========================================\n\n`;
  
  prayers.forEach((item, index) => {
    body += `${index + 1}. 【${item.name}】(${item.frequency})\n`;
    body += `📝 禱告內容：\n${item.content}\n`;
    body += `------------------------------------------\n\n`;
  });
  
  body += `此信件為系統自動發送，請勿直接回覆。`;
  
  // 3. 執行 Email 發送
  try {
    MailApp.sendEmail(RECEIVER_EMAIL, subject, body);
    console.log("Email 報表發送成功！");
  } catch (e) {
    console.error("發送 Email 時發生錯誤：", e.toString());
  }
}

/**
 * 當天無人需要代禱時的 Email 通知
 */
function sendEmptyReportEmail() {
  const RECEIVER_EMAIL = "528david@gmail.com";

  const todayStr = Utilities.formatDate(new Date(), "GMT+8", "yyyy-MM-dd");
  const subject = `ℹ️ 【禱告網絡通知】 - ${todayStr} 今日無排定人員`;
  const body = `平安！\n\n今日 (${todayStr}) 系統檢查完畢，無排定之代禱人員。\n\n祝您有美好的一天！`;
  
  try {
    MailApp.sendEmail(RECEIVER_EMAIL, subject, body);
  } catch (e) {
    console.error("發送無人通知 Email 時發生錯誤：", e.toString());
  }
}

/**
 * 建立每日清晨自動執行的時間驅動觸發器
 */
function createDailyTrigger() {
  // 先刪除舊的同名觸發器，避免重複設定
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "checkAndSendTodayPrayers") {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  // 建立每日清晨 6:00~7:00 自動執行
  ScriptApp.newTrigger("checkAndSendTodayPrayers")
    .timeBased()
    .everyDays(1)
    .atHour(6) 
    .create();
    
  console.log("✅ 每日報表檢查觸發條件已成功更新與設定！");
}