// 📂 Core_Services/Service_Gemini.gs

// 📂 Core_Services/Service_Gemini.gs

function analyzeEmailWithGemini(emailBody, dateContext, subject) {
  // 建议使用 1.5-flash，稳健且快
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${CONFIG.GEMINI_API_KEY}`;
  
  const prompt = `
  Role: Strict Recruitment Email Classifier.
  Current Time: ${dateContext}
  Subject: "${subject}"

  Task 1: CLASSIFY the email into one of these 5 categories:
  
  1. "OFFER": Success! Contains "内定" (Naitei), "採用" (Saiyo), "Offer", "合格" (Pass).
  2. "REJECTION": Failure. Contains "残念ながら" (Unfortunately), "見送り" (Pass over), "不採用", "ご期待に添えず".
  3. "CONFIRMATION": Interview time is DECIDED or FIXED (e.g., "10時に決定", "Please join via this link").
  4. "INVITATION": Asking for availability or candidate dates.
  5. "OTHER": Newsletters, spam, "Thank you for applying" (without next steps), or casual chit-chat.

  🚨 CRITICAL KEYWORD RULES (Priority):
  - If text contains "残念ながら" OR "見送り" -> MUST be "REJECTION".
  - If text contains "内定" -> MUST be "OFFER".

  Task 2: EXTRACT details.

  Output JSON Schema:
  {
    "category": "OFFER" | "REJECTION" | "CONFIRMATION" | "INVITATION" | "OTHER",
    "company": "String (Company Name)",
    "summary": "String (Brief summary)",
    "meeting_link": "String (URL) or null",
    "extracted_dates": ["ISO String"] 
  }

  Email Body:
  ${emailBody}
  `;

  const payload = {
    "contents": [{ "parts": [{ "text": prompt }] }],
    // 关闭安全拦截，防止误杀
    "safetySettings": [
      { "category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE" },
      { "category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE" },
      { "category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE" },
      { "category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE" }
    ],
    "generationConfig": { "response_mime_type": "application/json" }
  };

  try {
    const res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    
    // 增加防崩检查
    if (res.getResponseCode() !== 200) return null;
    const jsonResponse = JSON.parse(res.getContentText());
    if (!jsonResponse.candidates || jsonResponse.candidates.length === 0) return null;

    let rawText = jsonResponse.candidates[0].content.parts[0].text;
    rawText = rawText.replace(/```json/g, "").replace(/```/g, "").trim();
    const aiData = JSON.parse(rawText);

    return processAiResult(aiData);

  } catch (e) {
    Logger.log("Gemini Analysis Error: " + e.toString());
    return null;
  }
}

// 🟢 数据清洗与标准化函数 (升级版)
function processAiResult(data) {
  // 1. 垃圾过滤
  if (data.category === "OTHER") {
    Logger.log("Gemini 判定为无关邮件 (OTHER)，跳过。");
    return null; 
  }

  let result = {
    is_offer: false,       // 🎉 新增
    is_rejection: false,   // 💀 新增
    is_confirmation: false,
    is_interview: false,
    company: data.company || "Unknown",
    summary: data.summary,
    meeting_link: data.meeting_link,
    confirmed_time: null,
    has_fixed_time: false, // 兼容旧代码
    proposed_dates: data.extracted_dates || []
  };

  // 2. 逻辑分流
  if (data.category === "OFFER") {
    result.is_offer = true;
  } 
  else if (data.category === "REJECTION") {
    result.is_rejection = true;
  }
  else if (data.category === "CONFIRMATION") {
    result.is_confirmation = true;
    if (data.extracted_dates && data.extracted_dates.length > 0) {
      result.confirmed_time = data.extracted_dates[0];
    }
  } 
  else if (data.category === "INVITATION") {
    result.is_interview = true;
    result.has_fixed_time = false;
  }

  // 3. 兜底规则修正：有链接+唯一时间 依然是确认 (且不是 Offer/Rejection)
  if (data.meeting_link && data.extracted_dates && data.extracted_dates.length === 1 && !result.is_offer && !result.is_rejection) {
    Logger.log("规则修正：检测到 Link + 唯一时间 -> 强制判定为确认信");
    result.is_confirmation = true;
    result.is_interview = false;
    result.confirmed_time = data.extracted_dates[0];
  }

  return result;
}

// ... generateDraftReply 保持不变 ...
function generateDraftReply(originalBody, slots, companyName) {

  const userConfig = UserService.getConfig();
  const myName = userConfig.userName;
  // 保持你原有的逻辑
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${CONFIG.GEMINI_API_KEY}`;
  const timeStrings = slots.map(s => {
    return Utilities.formatDate(new Date(s.start), Session.getScriptTimeZone(), "MM/dd HH:mm") + " ~ " + Utilities.formatDate(new Date(s.end), Session.getScriptTimeZone(), "HH:mm");
  }).join("\n");
  const prompt = `你是一名求职者姓名是：${myName}。。对方公司是 ${companyName}。请根据对方邮件语言写一封回复邮件,回复落款请使用姓名：${myName}, 无需电话等其他信息。内容要求：1. 感谢邀请。2. 告知对方我在以下时间段方便：\n${timeStrings}\n3. 语气专业礼貌。\n对方邮件：\n${originalBody}\n⚠️ 请只返回纯 JSON: { "subject": "...", "body": "..." }`;
  const payload = { "contents": [{ "parts": [{ "text": prompt }] }], "generationConfig": { "response_mime_type": "application/json" } };
  try {
    const res = UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', payload: JSON.stringify(payload) });
    let rawText = JSON.parse(res.getContentText()).candidates[0].content.parts[0].text;
    rawText = rawText.replace(/```json/g, "").replace(/```/g, "").trim();
    return JSON.parse(rawText);
  } catch (e) {
    return { subject: `回复：面试邀请`, body: `(AI生成出错)\n\n请手动撰写，建议时间：\n` + timeStrings };
  }
}