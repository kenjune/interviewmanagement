// calender service

function findSmartSlots() {
  const cal = CalendarApp.getCalendarById(CONFIG.CALENDAR_ID);
  let slots = [];
  
  // 🟢 修改点：从 UserService 获取动态配置
  const userConfig = UserService.getConfig();
  
  const durationMin = userConfig.duration;       // 用户设定的面试时长
  const intervalMin = userConfig.slotInterval;   // 用户设定的间隔
  const delayHours = userConfig.minNoticeHours;  // 用户设定的最小提前量
  
  // 1. 确定起始时间 (现在 + N小时)
  let targetDate = new Date();
  targetDate.setHours(targetDate.getHours() + delayHours);

  
  const now = new Date();
  // 如果计算出的日期比现在还早（比如昨天），强制修正为今天
  if (targetDate < now) targetDate = new Date(now);

  Logger.log(`📅 开始寻找空闲时段，目标日期: ${Utilities.formatDate(targetDate, Session.getScriptTimeZone(), "yyyy-MM-dd")}`);

  // 2. 遍历未来 7 天寻找空位
  for (let i = 0; i < 10; i++) {
    if (slots.length >= 3) break; // 找够3个就停

    // 设定当天的搜索范围 (默认 10:00 - 19:00)
    let searchStart = new Date(targetDate);
    searchStart.setHours(CONFIG.WORK_START_HOUR, 0, 0, 0);
    
    // 如果搜索起点在“过去” (比如现在是15点，搜索起点是10点)，则从“下个小时”开始
    if (searchStart < now) {
      searchStart = new Date(now);
      searchStart.setHours(now.getHours() + 1, 0, 0, 0);
      searchStart.setMinutes(0, 0, 0); // 归整到整点
    }

    let searchEnd = new Date(targetDate);
    searchEnd.setHours(CONFIG.WORK_END_HOUR, 0, 0, 0);

    // 如果修正后的开始时间 已经晚于 结束时间 (比如现在20点，下班是19点)，今天就跳过
    if (searchStart >= searchEnd) {
      targetDate.setDate(targetDate.getDate() + 1); // 换下一天
      continue;
    }

    // 获取当天的忙碌事件
    const events = cal.getEvents(searchStart, searchEnd);

    // 开始扫描
    let cursor = new Date(searchStart);
    
    // 循环条件：当前时间 + 面试时长 <= 截止时间
    while (cursor.getTime() + (durationMin * 60000) <= searchEnd.getTime()) {
      let slotEnd = new Date(cursor.getTime() + (durationMin * 60000));
      
      // 碰撞检测：检查该时段是否和已有事件重叠
      let isBusy = events.some(e => {
        return (e.getStartTime() < slotEnd && e.getEndTime() > cursor);
      });

      if (!isBusy) {
        // ✅ 找到一个空位！
        slots.push({ start: new Date(cursor), end: new Date(slotEnd) }); // 确保是副本
        Logger.log(`✅ 找到空位: ${Utilities.formatDate(cursor, Session.getScriptTimeZone(), "MM-dd HH:mm")}`);
        
        if (slots.length >= 3) break;

        // 间隔逻辑：当前结束时间 + 间隔分钟
        cursor = new Date(slotEnd.getTime() + (intervalMin * 60000)); 
      } else {
        // ❌ 忙碌，往后挪 30 分钟再试
        cursor = new Date(cursor.getTime() + 30 * 60000);
      }
    }
    
    // 换下一天
    targetDate.setDate(targetDate.getDate() + 1);
  }
  
  return slots;
}

// 冻结逻辑
function freezeCalendarSlots(slots, companyName) {
  if (!slots || slots.length === 0) return [];

  const cal = CalendarApp.getCalendarById(CONFIG.CALENDAR_ID);
  
  return slots.map(slot => {
    // 🛡️ 防御性检查：确保开始时间确实早于结束时间
    if (slot.start >= slot.end) {
      Logger.log("❌ 严重错误：尝试创建非法时间段", slot);
      return null; // 跳过非法时段
    }

    try {
      const event = cal.createEvent(`[预留] 面试 - ${companyName}`, slot.start, slot.end, {
        description: "等待用户确认中..."
      });
      event.setColor(CalendarApp.EventColor.GRAY);
      
      return { id: event.getId(), start: slot.start, end: slot.end };
    } catch (e) {
      Logger.log(`⚠️ 创建日历事件失败: ${e.toString()}`);
      return null;
    }
  }).filter(item => item !== null); // 过滤掉失败的
}


// 📂 Core_Services/Service_Calendar.gs

// ... findSmartSlots 和 freezeCalendarSlots 保持不变 ...

/**
 * 确认最终时间，解冻其他
 * @param {string} slotIdsJson - 数据库里存的 '["id1", "id2"]'
 * @param {string} confirmedTimeStr - AI 提取的确认时间 (ISO string)
 * @returns {string} - 返回最终确认的那个事件的 Web Link (方便放入 LINE)
 */
function finalizeCalendarSlot(slotIdsJson, confirmedTimeStr) {
  if (!slotIdsJson || slotIdsJson === "[]") return null;
  
  const cal = CalendarApp.getCalendarById(CONFIG.CALENDAR_ID);
  const ids = JSON.parse(slotIdsJson);
  const targetDate = new Date(confirmedTimeStr);
  let confirmedEventLink = "";

  ids.forEach(id => {
    try {
      const event = cal.getEventById(id);
      if (!event) return;

      const eventStart = event.getStartTime();
      
      // 判定逻辑：检查事件开始时间是否与 AI 提取的时间接近 (误差15分钟内)
      // 因为 ISO 转换可能有微小时区差异
      const diff = Math.abs(eventStart.getTime() - targetDate.getTime());
      const isMatch = diff < 15 * 60 * 1000; // 15分钟容差

      if (isMatch) {
        // ✅ 命中：变蓝，改标题
        event.setColor(CalendarApp.EventColor.PALE_BLUE); // 正式色
        event.setTitle(event.getTitle().replace("[预留]", "[正式]"));
        event.setDescription("✅ 时间已由对方确认。\n" + event.getDescription());
        confirmedEventLink = "[https://calendar.google.com](https://calendar.google.com)"; // 简单返回日历链接
      } else {
        // ❌ 未命中：删除释放
        event.deleteEvent();
      }
    } catch (e) {
      Logger.log(`处理解冻事件失败 ID ${id}: ` + e.toString());
    }
  });
  
  return confirmedEventLink;
}