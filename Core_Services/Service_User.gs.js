// 📂 Core_Services/Service_User.gs

const UserService = {
  // 1. 获取配置
  getConfig: function() {
    try {
      const sheet = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName('DB_Config');
      if (!sheet) return this._getDefaultConfig(); // 容错：表不存在用默认值

      const data = sheet.getDataRange().getValues();
      let config = {};
      data.forEach(row => { if (row[0]) config[row[0].toString()] = row[1]; });
      
      return {
        userName: config['USER_NAME'] || 'Candidate',
        minNoticeHours: parseInt(config['MIN_NOTICE_HOURS']) || 24,
        slotInterval: parseInt(config['SLOT_INTERVAL_MIN']) || 60,
        duration: parseInt(config['INTERVIEW_DURATION']) || 60
      };
    } catch (e) {
      Logger.log("获取配置失败: " + e.toString());
      return this._getDefaultConfig();
    }
  },

  _getDefaultConfig: function() {
    return { userName: 'Candidate', minNoticeHours: 24, slotInterval: 60, duration: 60 };
  },

  // 2. 保存配置
  saveConfig: function(newConfig) {
    const sheet = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName('DB_Config');
    sheet.clear();
    const rows = [
      ['USER_NAME', newConfig.userName],
      ['MIN_NOTICE_HOURS', newConfig.minNoticeHours],
      ['SLOT_INTERVAL_MIN', newConfig.slotInterval],
      ['INTERVIEW_DURATION', newConfig.duration]
    ];
    sheet.getRange(1, 1, rows.length, 2).setValues(rows);
  },

  // 3. 保存备注
  saveNote: function(threadId, noteContent) {
    const sheet = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName('DB_Applications');
    const data = sheet.getDataRange().getValues();
    // 去掉可能的单引号
    const targetId = String(threadId).replace(/^'/, "").trim();
    
    // J列索引=9, D列索引=3
    for (let i = data.length - 1; i >= 0; i--) {
      let rowId = String(data[i][3]).replace(/^'/, "").trim();
      if (rowId === targetId) {
        sheet.getRange(i + 1, 10).setValue(noteContent);
        return "Saved";
      }
    }
    return "Not Found";
  },
  
  // 4. 获取日程 (放宽过滤逻辑)
  getUpcomingSchedule: function() {
    try {
      const cal = CalendarApp.getCalendarById(CONFIG.CALENDAR_ID);
      const now = new Date();
      const nextWeek = new Date();
      nextWeek.setDate(now.getDate() + 7);
      
      const events = cal.getEvents(now, nextWeek);
      
      return events.map(e => ({
        title: e.getTitle(),
        start: Utilities.formatDate(e.getStartTime(), Session.getScriptTimeZone(), "MM/dd HH:mm"),
        // 增加原始时间对象用于排序
        _startTime: e.getStartTime().getTime(),
        color: e.getColor() === CalendarApp.EventColor.GRAY ? 'gray' : 'blue',
        isInterview: e.getTitle().includes("面试") || e.getTitle().includes("Interview")
      }))
      // 🟢 修正：不再强制过滤，而是返回所有，交给前端去展示（或者只过滤掉明显的私人事件）
      // 这里只过滤掉全天事件，保留所有有时长的事件
      .filter(e => !e.isAllDayEvent) 
      .sort((a, b) => a._startTime - b._startTime);

    } catch (e) {
      Logger.log("获取日程失败: " + e.toString());
      return []; // 返回空数组，不让前端转圈圈
    }
  }
};