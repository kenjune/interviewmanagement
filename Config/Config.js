// Config.gs
const CONFIG = {
  // === 敏感信息 (建议将来放入 Script Properties) ===
  GEMINI_API_KEY: 'your gemini api key here', 
  LINE_CHANNEL_TOKEN: 'your line channel token here',
  
  // === 业务配置 ===
  SHEET_ID: SpreadsheetApp.getActiveSpreadsheet().getId(),
  CALENDAR_ID: 'primary', // 默认日历
  USER_ID_LINE: 'your user id here', // 用于测试时直接推送给你
  
  // === 规则配置 ===
  INTERVIEW_DURATION: 60, // 默认60分钟
  WORK_START_HOUR: 10,
  WORK_END_HOUR: 19,
  INTERVIEW_DURATION: 60,      // 面试时长 (分)
  SLOT_INTERVAL_MIN: 30,       // 两个候选时段的中间间隔 (分)
  DELAY_DAYS: 0,               // N天后开始找 (测试用0，表示今天/明天)
  CHECK_DAYS_AHEAD: 7 // 检查未来7天的空闲时间
};