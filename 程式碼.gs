function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🙏 禱告卡片')
    .addItem('▶ 下一項', 'nextPrayer')
    .addItem('◀ 上一項', 'prevPrayer')
    .addItem('🎲 隨機一項', 'randomPrayer')
    .addItem('✏ 跳到週期欄位', 'jumpToCycle')
    .addSeparator()
    .addItem('⚙ 初始化/重建卡片頁', 'setupPrayerCard')
    .addToUi();
}

function setupPrayerCard() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const dataSheet = ss.getSheetByName('表單回覆 1');
  if (!dataSheet) {
    safeAlert('找不到名為「表單回覆 1」的分頁，請確認分頁名稱是否一致。');
    return;
  }

  let card = ss.getSheetByName('禱告卡片');
  if (card) ss.deleteSheet(card);
  card = ss.insertSheet('禱告卡片');

  // 主要卡片內容
  card.getRange('B2').setFormula('="第 " & G1 & " 項 / 共 " & (COUNTA(\'表單回覆 1\'!B:B)-1) & " 項"');
  card.getRange('B6').setFormula('="目前週期："&IFERROR(INDEX(\'表單回覆 1\'!C:C, G1+1), "")');
  card.getRange('B8').setFormula('=IFERROR(INDEX(\'表單回覆 1\'!D:D, G1+1), "")');
  card.getRange('B13').setFormula('="目前標籤："&IFERROR(INDEX(\'表單回覆 1\'!H:H, G1+1), "")');
  card.getRange('G1').setValue(1);

  // 格式
  card.getRange('B2').setFontSize(12).setFontWeight('bold');
  card.getRange('B4').setFontSize(22).setWrap(true);
  card.setRowHeight(4, 120);
  card.getRange('B6').setFontSize(14);
  card.getRange('B8').setFontSize(12).setFontColor('#666666').setWrap(true);
  card.getRange('B13').setFontSize(14);
  card.getRange('D6').setFontSize(14).setBackground('#fff2cc');
  card.getRange('D13').setFontSize(14).setBackground('#cfe2f3');

const cycleRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['D每天', '2每兩天', '3每三天', 'W每週', 'DW每兩週', 'M每月', '2M每兩個月', 'S每季', 'HY每半年', 'Y每年'], true)
    .setAllowInvalid(true)
    .build();
  card.getRange('D6').setDataValidation(cycleRule);

  // 標籤欄位資料驗證（固定清單）
  const tagRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['G工作日', 'W週末', 'F家庭會議', 'A安祺禱告'], true)
    .setAllowInvalid(true)
    .build();
  card.getRange('D13').setDataValidation(tagRule);

  card.setColumnWidth(1, 30);
  card.setColumnWidth(2, 500);
  card.setColumnWidth(4, 150);

  // 翻頁按鈕（打勾方塊模擬按鈕）
  card.getRange('B10').insertCheckboxes();
  card.getRange('C10').setValue('◀ 上一項').setFontSize(16).setFontWeight('bold');
  card.getRange('B10:C10').setBackground('#d9ead3');
  card.setRowHeight(10, 40);

  card.getRange('B12').insertCheckboxes();
  card.getRange('C12').setValue('▶ 下一項').setFontSize(16).setFontWeight('bold');
  card.getRange('B12:C12').setBackground('#d9ead3');
  card.setRowHeight(12, 40);

  // 週期代碼對照表（E、F欄）
  const cycleTable = [
    ['代碼', '說明'],
    ['D', '每天'],
    ['2', '每兩天'],
    ['3', '每三天'],
    ['W', '每週'],
    ['DW', '每兩週'],
    ['M', '每月'],
    ['2M', '每兩個月'],
    ['S', '每季'],
    ['HY', '每半年'],
    ['Y', '每年']
  ];
  card.getRange(1, 5, cycleTable.length, 2).setValues(cycleTable);
  card.getRange(2, 5, cycleTable.length - 1, 1).setNumberFormat('@');
  card.getRange('E1:F1').setFontWeight('bold').setBackground('#e0e0e0');

  // 標籤對照表（緊接在週期對照表下方）
  const tagStartRow = cycleTable.length + 2; // 空一列
  const tagTable = [
    ['標籤', '說明'],
    ['G', '工作日'],
    ['W', '週末'],
    ['F', '家庭會議'],
    ['A', '安祺禱告']
  ];
  card.getRange(tagStartRow, 5, tagTable.length, 2).setValues(tagTable);
  card.getRange(tagStartRow, 5, 1, 2).setFontWeight('bold').setBackground('#e0e0e0');
  card.getRange(tagStartRow + 1, 5, tagTable.length - 1, 1).setNumberFormat('@');

  card.setColumnWidth(5, 60);
  card.setColumnWidth(6, 100);

  // 初始化 B4 內容（第一筆）
  refreshCardText();

  ss.setActiveSheet(card);
  safeAlert('✅ 禱告卡片頁已建立完成！請重新整理瀏覽器頁面。');
}

function safeAlert(msg) {
  try {
    SpreadsheetApp.getUi().alert(msg);
  } catch (err) {
    Logger.log(msg);
  }
}

function refreshCardText() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const card = ss.getSheetByName('禱告卡片');
  const data = ss.getSheetByName('表單回覆 1');
  const idx = card.getRange('G1').getValue();
  const total = data.getLastRow() - 1;
  if (idx < 1 || idx > total) return;
  const value = data.getRange(idx + 1, 2).getValue();
  card.getRange('B4').setValue(value);
}

function nextPrayer() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const card = ss.getSheetByName('禱告卡片');
  const data = ss.getSheetByName('表單回覆 1');
  const total = data.getLastRow() - 1;
  const idxCell = card.getRange('G1');
  let idx = idxCell.getValue() || 0;
  idx = (idx % total) + 1;
  idxCell.setValue(idx);
  refreshCardText();
}

function prevPrayer() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const card = ss.getSheetByName('禱告卡片');
  const data = ss.getSheetByName('表單回覆 1');
  const total = data.getLastRow() - 1;
  const idxCell = card.getRange('G1');
  let idx = idxCell.getValue() || 1;
  idx = idx - 1 < 1 ? total : idx - 1;
  idxCell.setValue(idx);
  refreshCardText();
}

function randomPrayer() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const card = ss.getSheetByName('禱告卡片');
  const data = ss.getSheetByName('表單回覆 1');
  const total = data.getLastRow() - 1;
  const idxCell = card.getRange('G1');
  idxCell.setValue(Math.floor(Math.random() * total) + 1);
  refreshCardText();
}

function jumpToCycle() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const card = ss.getSheetByName('禱告卡片');
  ss.setActiveSheet(card);
  card.getRange('D6').activate();
}

function onEdit(e) {
  const sheet = e.source.getActiveSheet();
  if (sheet.getName() !== '禱告卡片') return;

  const a1 = e.range.getA1Notation();

  // 手動輸入 G1 → 直接跳項
  if (a1 === 'G1') {
    const data = e.source.getSheetByName('表單回覆 1');
    const total = data.getLastRow() - 1;
    let idx = e.range.getValue();

    if (!idx || idx < 1) {
      idx = 1;
      e.range.setValue(1);
    } else if (idx > total) {
      idx = total;
      e.range.setValue(total);
    }

    refreshCardText();
    return;
  }

  // 打勾按鈕：上一項
  if (a1 === 'B10') {
    if (e.range.getValue() === true) {
      prevPrayer();
      e.range.setValue(false);
    }
    return;
  }

  // 打勾按鈕：下一項
  if (a1 === 'B12') {
    if (e.range.getValue() === true) {
      nextPrayer();
      e.range.setValue(false);
    }
    return;
  }

  // B4 手動編輯 → 同步寫回表單回覆 1 對應列的 B 欄
  if (a1 === 'B4') {
    const newValue = e.range.getValue();
    const idx = sheet.getRange('G1').getValue();
    const dataSheet = e.source.getSheetByName('表單回覆 1');
    if (idx) {
      dataSheet.getRange(idx + 1, 2).setValue(newValue);
    }
    return;
  }

  // 週期欄位自動校正 → 寫回 C 欄
  if (a1 === 'D6') {
    let newValue = e.range.getValue();
    if (!newValue) return;
    newValue = newValue.toString().trim().toUpperCase();

    const CYCLE_MAP = {
      'DW': 'DW每兩週',
      '2M': '2M每兩個月',
      'HY': 'HY每半年',
      'D': 'D每天',
      '2': '2每兩天',
      '3': '3每三天',
      'W': 'W每週',
      'M': 'M每月',
      'S': 'S每季',
      'Y': 'Y每年'
    };

    let matched = CYCLE_MAP[newValue];
    if (matched) {
      if (matched !== e.range.getValue()) e.range.setValue(matched);
      newValue = matched;
    } else {
      newValue = e.range.getValue().toString();
    }

    const idx = sheet.getRange('G1').getValue();
    const dataSheet = e.source.getSheetByName('表單回覆 1');
    dataSheet.getRange(idx + 1, 3).setValue(newValue);
    return;
  }

  // 標籤欄位自動校正 → 寫回 H 欄
  if (a1 === 'D13') {
    let newValue = e.range.getValue();
    if (!newValue) return;
    newValue = newValue.toString().trim().toUpperCase();

    const TAG_MAP = {
      'G': 'G工作日',
      'W': 'W週末',
      'F': 'F家庭會議',
      'A': 'A安祺禱告'
    };

    let matched = TAG_MAP[newValue];
    if (matched) {
      if (matched !== e.range.getValue()) e.range.setValue(matched);
      newValue = matched;
    } else {
      newValue = e.range.getValue().toString();
    }

    const idx = sheet.getRange('G1').getValue();
    const dataSheet = e.source.getSheetByName('表單回覆 1');
    dataSheet.getRange(idx + 1, 8).setValue(newValue); // H欄 = 第8欄
    return;
  }
}

function listSheetNames() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = ss.getSheets();
  const names = sheets.map(s => s.getName());
  Logger.log(names.join('\n'));
}
