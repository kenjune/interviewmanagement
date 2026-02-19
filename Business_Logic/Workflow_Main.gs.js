// Workflow_Main.gs



// ⚠️ 主触发入口：请设置 Time-driven Trigger 每10分钟运行此函数
function main_autoRecruit_pipeline() {
  // 1. 读取未读邮件 (精准搜索)
  // 搜索条件：未读 + 标题含(面试/interview/選考) + 未处理
  const query = 'is:unread subject:("選考" OR "interview" OR "面试") -label:已处理';
  
  // 每次只处理 1-3 封，避免超时
  const threads = GmailApp.search(query, 0, 3); 
  
  if (threads.length === 0) {
    console.log("没有符合条件的未读邮件。");
    return;
  }
  
  threads.forEach(thread => {
    try {
      processSingleThread(thread);
    } catch (e) {
      console.error(`处理邮件失败 (ID: ${thread.getId()}): ${e.toString()}`);
    }
  });
}

// 单个会话的处理逻辑
function processSingleThread(thread) {
  // 1. 获取该会话下的所有邮件
  const allMessages = thread.getMessages();
  
  // 🟢 修正点：获取“最新”的一封邮件 (数组的最后一个)
  const msg = allMessages[allMessages.length - 1]; 
  
  // 🛡️ 防御性检查：如果最新这封邮件是“我”发出去的，那就不要处理
  // (防止你刚回复完，脚本运行了，结果分析了你自己写的邮件)
  const myEmail = Session.getActiveUser().getEmail();
  if (msg.getFrom().includes(myEmail)) {
    Logger.log("最新邮件是我发送的，跳过处理。");
    return;
  }

  const body = msg.getPlainBody();
  const subject = thread.getFirstMessageSubject(); // 标题通常用第一封的即可

  // 2. Gemini 分析邮件意图
  Logger.log(`正在分析最新邮件: ${subject}`);
  
  // 调用分析函数 (注意：Service_Gemini.gs 必须是最新版)
  const analysis = analyzeEmailWithGemini(body, new Date().toString(), subject);
  
  // 如果 AI 分析失败，或者判定为无关邮件，直接跳过
  if (!analysis) {
    Logger.log("AI 分析返回空或判定为无关邮件，跳过。");
    return;
  }
  
  // 进入核心业务逻辑
  handleInterviewLogic(thread, analysis, body);

  // 3. 收尾工作：打标签
  const labelName = '已处理';
  let label = GmailApp.getUserLabelByName(labelName);
  if (!label) label = GmailApp.createLabel(labelName);
  thread.addLabel(label);
  
  // thread.markRead(); // 调试完成后可以取消注释
}

// 核心：根据 AI 结果决定下一步动作
// 📂 Business_Logic/Workflow_Main.gs



function handleInterviewLogic(thread, aiData, originalBody) {
  const sheet = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName('DB_Applications');
  const threadId = thread.getId();
  
  // 1. 获取 Thread 历史记录
  const allData = sheet.getDataRange().getValues();
  let lastRecordIndex = -1;
  let lastRecord = null;
  
  Logger.log(`🔍 正在数据库中查找 Thread ID: ${threadId}`);

  // 倒序查找该 Thread 的最后一条记录
  for (let i = allData.length - 1; i >= 0; i--) {
    // 🔴 核心修复：强制转为字符串并去空格，防止格式不匹配导致找不到记录
    // (Sheet 有时会自动把数字 ID 转成数字类型，导致 === 失败)
    const rowThreadId = String(allData[i][3]).trim(); 
    const currentThreadId = String(threadId).trim();

    if (rowThreadId === currentThreadId) {
      lastRecord = allData[i];
      lastRecordIndex = i + 1; // 记录行号 (Sheet是从1开始)
      Logger.log(`✅ 找到匹配记录，在第 ${lastRecordIndex} 行`);
      break;
    }
  }

  if (lastRecordIndex === -1) {
    Logger.log("⚠️ 未找到历史记录，后续将作为新记录处理");
  }

  const currentRound = lastRecord ? parseInt(lastRecord[4]) : 1;
  let slotIdsJson = lastRecord ? lastRecord[5] : "[]"; // Slot_IDs

  // =================================================
  // 🎉 分支 0: 成功终止 (OFFER / 内定)
  // =================================================
  if (aiData.is_offer) {
    Logger.log("🎉 CONGRATS! Offer Received!");

    const lineMsg = `${aiData.company} / Offer 🎉`;
    sendLinePush("Congratulations!", lineMsg, null);

    saveApplication({
      threadId: threadId,
      company: aiData.company,
      status: "🎉 内定获得 (Offer)",
      roundCount: currentRound,
      slotIds: slotIdsJson, 
      summary: "收到内定通知！",
      meetingLink: "",
      confirmedTime: ""
    });
    return;
  }

  // =================================================
  // 💀 分支 -1: 失败终止 (REJECTION / 拒信)
  // =================================================
  if (aiData.is_rejection) {
    Logger.log("😢 Rejection detected.");

    saveApplication({
      threadId: threadId,
      company: aiData.company,
      status: "❌ 不採用 (Rejection)",
      roundCount: currentRound,
      slotIds: slotIdsJson, 
      summary: "收到拒信",
      meetingLink: "",
      confirmedTime: ""
    });
    return;
  }

  // =================================================
  // 🔀 分支 1: 对方确认了时间 (Confirmation)
  // =================================================
  if (aiData.is_confirmation) {
    Logger.log("检测到确认信...");
    let meetingLink = aiData.meeting_link || "Offline/No Link Found";
    let confirmedTime = aiData.confirmed_time;
    
    // 🔴 修复验证：确保有 ID 且 ID 不是空的字符串
    // 只有找到了上一条记录 (slotIdsJson 有值)，才能去解冻
    if (slotIdsJson && slotIdsJson !== "[]" && slotIdsJson.length > 5) {
      Logger.log(`正在尝试解冻日历，IDs: ${slotIdsJson}`);
      // 调用你现有的 Service_Calendar 函数
      finalizeCalendarSlot(slotIdsJson, confirmedTime);
    } else {
      Logger.log("⚠️ 无法解冻：Slot_IDs 为空，可能是因为没找到上一条记录");
    }

    const lineMsg = `
Time Confirmed ✅
----------------
Company: ${aiData.company}
Round: ${currentRound}
Time: ${confirmedTime ? Utilities.formatDate(new Date(confirmedTime), Session.getScriptTimeZone(), "MM/dd HH:mm") : "Check Email"}
Link: ${meetingLink}
(Calendar updated)`.trim();

    sendLinePush("Interview Confirmed", lineMsg, null);

    // 🔴 更新上一条记录 (而不是新建)
    if (lastRecordIndex > 0) {
      Logger.log(`更新数据库第 ${lastRecordIndex} 行...`);
      
      // 更新 C列 (Status)
      sheet.getRange(lastRecordIndex, 3).setValue("时间已确认");
      
      // 更新 G列 (Meeting_Link)
      if (meetingLink) sheet.getRange(lastRecordIndex, 7).setValue(meetingLink);
      
      // 更新 I列 (Confirmed_Time)
      if (confirmedTime) sheet.getRange(lastRecordIndex, 9).setValue(confirmedTime);
      
      // 更新 H列 (Last_Update) - 这里假设 Summary 在 H 列 (第8列) 后面，如果没有 H 列 update 时间可忽略
      // sheet.getRange(lastRecordIndex, 8).setValue(new Date()); 
    } else {
        // 只有真的找不到时，才补录
        saveApplication({
            threadId: threadId,
            company: aiData.company,
            status: "时间已确认(补录)",
            roundCount: currentRound,
            slotIds: "[]",
            summary: "确认信补录 (未找到原始记录)",
            meetingLink: meetingLink,
            confirmedTime: confirmedTime
        });
    }
    return;
  }

  // =================================================
  // 🔀 分支 2: 新的面试邀请 (Invitation)
  // =================================================
  if (aiData.is_interview) {
    let newRoundCount = currentRound;
    // 简单的轮次判断
    if (lastRecord && (String(lastRecord[2]).includes("确认") || String(lastRecord[2]).includes("已发送"))) {
       newRoundCount += 1;
    }

    let status = `第 ${newRoundCount} 轮安排中`;
    let slotIdsJsonNew = "[]"; 

    // 找时间逻辑
    const freeSlots = findSmartSlots();
    if (freeSlots.length > 0) {
        const lockedEvents = freezeCalendarSlots(freeSlots, aiData.company);
        const ids = lockedEvents.map(e => e.id);
        slotIdsJsonNew = JSON.stringify(ids); 
        
        const draftContent = generateDraftReply(originalBody, lockedEvents, aiData.company);
        const draft = thread.createDraftReply(draftContent.body);
        
        sendFlexMessage(aiData.company, aiData.summary, lockedEvents, draftContent.body, draft.getId(), threadId);
        
        status = "已冻结待确认";
    } else {
        status = "无空闲时间需人工介入";
        sendLinePush("⚠️ 日历已满", `无法为 ${aiData.company} 找到空位。`, null);
    }

    // 插入新记录
    saveApplication({
      threadId: threadId,
      company: aiData.company,
      status: status,
      roundCount: newRoundCount,
      slotIds: slotIdsJsonNew,
      summary: aiData.summary,
      meetingLink: "",
      confirmedTime: ""
    });
  }
}