// 📂 Interface/Controller_Line.gs

// 发送普通通知
function sendLinePush(title, body, extra) {
  const url = 'https://api.line.me/v2/bot/message/push';
  const payload = {
    "to": CONFIG.USER_ID_LINE,
    "messages": [{ "type": "text", "text": `🔔 ${title}\n\n${body}` }]
  };
  try {
    UrlFetchApp.fetch(url, {
      'method': 'post',
      'headers': { 'Authorization': 'Bearer ' + CONFIG.LINE_CHANNEL_TOKEN },
      'contentType': 'application/json',
      'payload': JSON.stringify(payload)
    });
  } catch (e) { console.error(e); }
}

// 发送 Flex Message (保持你原有的逻辑，这里为了节省篇幅简写，请保留你原来的 sendFlexMessage 函数)
function sendFlexMessage(company, summary, slots, draftBody, draftId, threadId) {
  // ... 请保留你原来的 sendFlexMessage 代码 ...
  // (如果你需要我再次提供 sendFlexMessage 请告诉我，否则直接保留即可)
  const url = 'https://api.line.me/v2/bot/message/push';
  
  let timeText = "（无时间段信息）";
  if (slots && slots.length > 0) {
    timeText = slots.map((s, i) => 
      `${i+1}. ${Utilities.formatDate(new Date(s.start), Session.getScriptTimeZone(), "MM/dd HH:mm")}`
    ).join("\n");
  }

  const flexContainer = {
    "type": "bubble",
    "header": {
      "type": "box",
      "layout": "vertical",
      "contents": [
        { "type": "text", "text": "🔔 新面试邀请", "weight": "bold", "color": "#1DB446" },
        { "type": "text", "text": company || "未知公司", "weight": "bold", "size": "xl", "margin": "md" }
      ]
    },
    "body": {
      "type": "box",
      "layout": "vertical",
      "contents": [
        { "type": "text", "text": "AI 已摘要：", "size": "xs", "color": "#aaaaaa" },
        { "type": "text", "text": summary || "无摘要", "wrap": true, "margin": "sm" },
        { "type": "separator", "margin": "md" },
        { "type": "text", "text": "📅 已冻结时段：", "size": "sm", "margin": "md", "weight": "bold" },
        { "type": "text", "text": timeText, "wrap": true, "size": "sm", "margin": "sm", "color": "#555555" },
        { "type": "separator", "margin": "md" },
        { "type": "text", "text": "📧 拟定回复预览：", "size": "sm", "margin": "md", "weight": "bold" },
        { "type": "text", "text": (draftBody ? draftBody.substring(0, 100) + "..." : "无草稿"), "wrap": true, "size": "xs", "color": "#888888", "margin": "sm" }
      ]
    },
    "footer": {
      "type": "box",
      "layout": "horizontal",
      "spacing": "sm",
      "contents": [
        {
          "type": "button",
          "style": "secondary",
          "action": {
            "type": "postback",
            "label": "✏️ 修改",
            "data": `action=edit&threadId=${threadId}`
          }
        },
        {
          "type": "button",
          "style": "primary",
          "action": {
            "type": "postback",
            "label": "🚀 确认发送",
            "data": `action=send&draftId=${draftId}`
          }
        }
      ]
    }
  };

  const payload = {
    "to": CONFIG.USER_ID_LINE,
    "messages": [{ "type": "flex", "altText": "收到面试邀请，请确认回复", "contents": flexContainer }]
  };

  try {
    UrlFetchApp.fetch(url, {
      'method': 'post',
      'headers': { 'Authorization': 'Bearer ' + CONFIG.LINE_CHANNEL_TOKEN },
      'contentType': 'application/json',
      'payload': JSON.stringify(payload)
    });
  } catch (e) {
    Logger.log("Send Flex Error: " + e.toString());
  }
}

// === 核心交互逻辑 (修复版) ===
function doPost(e) {
  // 1. 强制获取日志表 (DB_Logs)
  let sheetLog = null;
  try {
    sheetLog = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName('DB_Logs');
  } catch(err) {
    console.error("无法打开 DB_Logs，请检查表名是否正确");
  }

  // 定义写日志函数
  const appendLog = (status, msg) => {
    if (sheetLog) {
      // 这里的 appendRow 绝对只会写到 sheetLog 指向的表
      sheetLog.appendRow([new Date(), status, "LINE_WEBHOOK", msg]);
    }
  };

  try {
    const json = JSON.parse(e.postData.contents);
    if (json.events.length === 0) return;
    
    const event = json.events[0];
    const replyToken = event.replyToken;

    if (event.type === 'postback') {
      const data = event.postback.data; 
      appendLog("CLICKED", `数据: ${data}`); // 写日志

      // === 分支 A: 确认发送邮件 ===
      if (data.includes('action=send')) {
        const parts = data.split('draftId=');
        const draftId = parts.length > 1 ? parts[1].split('&')[0] : null;
        
        if (!draftId) {
          replyLine(replyToken, "❌ 错误：无法读取草稿 ID。");
          return;
        }

        try {
          const draft = GmailApp.getDraft(draftId);
          if (draft) {
            // 1. 获取 Thread ID (为了去主数据库更新状态)
            const threadId = draft.getMessage().getThread().getId();
            
            // 2. 发送邮件
            draft.send(); 
            
            // 3. 回复 LINE
            replyLine(replyToken, "✅ 邮件已成功发送！\n(状态已更新)");
            appendLog("SUCCESS", `邮件已发 ID: ${draftId}`);

            // 4. 更新主数据库状态 (业务逻辑)
            updateStatusInDb(threadId, "邮件已发送 (等待面试确认)"); 

          } else {
            replyLine(replyToken, "⚠️ 发送失败：草稿不存在。\n(可能已发送)");
            appendLog("ERROR", "草稿丢失/已发");
          }
        } catch (sendErr) {
          replyLine(replyToken, "❌ 发送报错: " + sendErr.message);
          appendLog("FATAL", sendErr.toString());
        }
      } 
      
      // === 分支 B: 修改邮件 ===
      else if (data.includes('action=edit')) {
        const parts = data.split('threadId=');
        const threadId = parts.length > 1 ? parts[1].split('&')[0] : null;
        const gmailLink = `https://mail.google.com/mail/u/0/#inbox/${threadId}`;
        
        replyLine(replyToken, `📝 请点击下方链接跳转 Gmail 修改并手动发送：\n\n${gmailLink}`);
        appendLog("INFO", "请求编辑");
      }
    }
  } catch (error) {
    appendLog("SYSTEM_ERROR", error.toString());
  }
}

// 辅助函数：回复 LINE
function replyLine(token, text) {
  UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
    'method': 'post',
    'headers': { 'Authorization': 'Bearer ' + CONFIG.LINE_CHANNEL_TOKEN },
    'contentType': 'application/json',
    'payload': JSON.stringify({
      replyToken: token,
      messages: [{ type: 'text', text: text }]
    })
  });
}

// 辅助函数：更新主数据库 (DB_Applications)
function updateStatusInDb(threadId, newStatus) {
  try {
    const sheetApp = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName('DB_Applications');
    const data = sheetApp.getDataRange().getValues();
    
    // 假设 D列是 Thread_ID (索引3)
    for (let i = data.length - 1; i >= 0; i--) {
      if (data[i][3] === threadId) { 
        // 更新 C列 (Status, 索引2)
        sheetApp.getRange(i + 1, 3).setValue(newStatus);
        // 更新 H列 (Last_Update, 索引7) —— 根据你的新表头结构，请确认 Last_Update 在哪一列
        // 假设表头是: Time | Company | Status | Thread | Round | Slots | Link | Summary | Confirmed | Last_Update
        // 如果 Last_Update 是第 10 列 (索引9)，请改为 10
        // 如果还没加 Last_Update 列，这行可以先注释掉
        break; 
      }
    }
  } catch (e) {
    console.error("更新状态失败: " + e.toString());
  }
}