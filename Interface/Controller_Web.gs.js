// 📂 Interface/Controller_Web.gs

// 1. 渲染 HTML 页面 (访问 Web App URL 时触发)
function doGet(e) {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('AI 面试看板 ✨')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function getFullDashboardData() {
  try {
    const sheet = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName('DB_Applications');
    if (!sheet) throw new Error("数据库表 DB_Applications 未找到");

    const data = sheet.getDataRange().getValues();
    data.shift(); // 去表头
    
    const apps = data.map((row, index) => ({
      rowIndex: index + 2,
      // 🟢 修正：日期转字符串，防止前端解析报错
      timestamp: row[0] ? Utilities.formatDate(new Date(row[0]), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm") : "",
      company: row[1],
      status: row[2],
      threadId: String(row[3]).replace(/^'/, "").trim(),
      round: row[4],
      summary: row[7],
      note: row[9] || ""
    })).reverse();

    return {
      success: true, // 增加成功标记
      applications: apps,
      config: UserService.getConfig(),
      schedule: UserService.getUpcomingSchedule()
    };
  } catch (e) {
    Logger.log("Dashboard Error: " + e.toString());
    return {
      success: false,
      error: e.toString()
    };
  }
}

// 3. API: 保存用户配置
function apiSaveConfig(formConfig) {
  UserService.saveConfig(formConfig);
  return "Saved";
}

// 4. API: 保存面试备注
function apiSaveNote(threadId, note) {
  return UserService.saveNote(threadId, note);
}

function apiSaveConfig(formConfig) { UserService.saveConfig(formConfig); return "Saved"; }
function apiSaveNote(threadId, note) { return UserService.saveNote(threadId, note); }
function apiConfirmSlot(slotId, ids, idx) { confirmFinalSlot(slotId, ids); return "OK"; }