// Service_Sheet.gs

// 🟢 核心修复：严格对应 A-I 列的顺序
function saveApplication(data) {
  const sheet = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName('DB_Applications');
  
  sheet.appendRow([
    new Date(),             // A: TimeStamp (写入当前时间)
    data.company,           // B: Company   (写入公司名)
    data.status,            // C: Status    (写入状态)
    "'" + data.threadId,    // D: Thread_ID (⚠️加上 ' 强制变为纯文本，解决ID匹配问题)
    data.roundCount,        // E: Round_Count
    data.slotIds,           // F: Slot_IDs
    data.meetingLink || "", // G: Meeting_Link (如果没有就是空)
    data.summary,           // H: Summary
    data.confirmedTime || ""// I: Confirmed_Time
  ]);
}