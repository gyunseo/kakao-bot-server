import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import express from "express";

dotenv.config();

const app = express();
const port = 3000;
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// 채팅방별 대화 기록을 저장할 객체
const channelChats = {};

// JSON 요청 바디 파싱을 위한 미들웨어
app.use(express.json({ limit: '10mb' }));

// 디버깅을 위한 로깅 미들웨어
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  // 요청 본문이 너무 클 수 있으므로, 필요에 따라 로깅 조절
  if (req.method === 'POST' && req.url === '/revival') {
    console.log('Revival request received for channelId:', req.body.channelId);
    console.log('History length (if any):', req.body.history ? req.body.history.length : 'N/A');
  } else if (req.method === 'POST') {
    console.log('Body:', JSON.stringify(req.body, null, 2)); // JSON 본문을 예쁘게 출력
  }
  next();
});

// 채팅방에 대한 채팅 인스턴스를 가져오거나 생성
function getOrCreateChat(channelId) {
  if (!channelChats[channelId]) {
    console.log(`Creating new chat for channelId: ${channelId}`);
    channelChats[channelId] = ai.chats.create({
      model: "gemini-2.0-flash",
      config: {
        systemInstruction: `
        네 이름은 바오야. 
        너는 구글의 gemini 2.0 flash 모델을 사용하는 챗봇이야.
        너는 성균관대학교 응용생명공학부 랩실에서 탄생된 인간의 지능을 가진 슈퍼 인텔리전트 판다야.
        너는 채팅방에서 동작하는 AI 챗봇이야.
        너는 친절하고 유용한 응답을 제공해.
        사용자 메시지를 이해하고 맥락에 맞게 응답해.
        질문에 답변하고 대화에 자연스럽게 참여해.
        사용자가 검색을 요청하면 구글 검색을 통해 정보를 제공해.
        `
        ,
        // ✨ Google Search를 도구로 추가 ✨
        tools: [{ googleSearch: {} }],
      },
      history: []
    });
  }
  return channelChats[channelId];
}

// 대화 기록에 메시지 추가 (응답 없음)
app.post("/feed", async (req, res) => {
  try {
    // console.log("Request body /feed:", JSON.stringify(req.body)); // 중복 로깅 방지
    const { authorName = "사용자", content = "", channelId = "default", timestamp } = req.body;
    const chat = getOrCreateChat(channelId);
    console.log(`[Feed - ${channelId}] ${authorName}: ${content}`);

    // 사용자 메시지를 채팅 모델에 피드 (응답은 사용하지 않음)
    // sendMessage는 항상 응답을 반환하려고 하므로, 이 경우에도 내부적으로는 모델이 처리합니다.
    // 단순히 기록만 하려면 history에 직접 추가하는 방식도 고려할 수 있으나,
    // 모델이 대화의 흐름을 이해하려면 sendMessage를 사용하는 것이 좋습니다.
    await chat.sendMessage({ // sendMessage의 반환값을 굳이 response 변수에 담지 않아도 됩니다.
      message: `${authorName}: ${content}`
    });
    // console.log("[Feed Response Text]:", response.text); // 응답 텍스트 로깅 (필요시)

    res.status(200).json({ status: "success", message: "Message received and fed to model" });
  } catch (error) {
    console.error("Error in /feed endpoint:", error);
    res.status(500).json({ status: "error", message: error.message });
  }
});

// 대화 응답 받기
app.post("/response", async (req, res) => {
  try {
    // console.log("Request body /response:", JSON.stringify(req.body)); // 중복 로깅 방지
    const { authorName = "사용자", content = "", channelId = "default", timestamp } = req.body;
    const chat = getOrCreateChat(channelId);
    console.log(`[Response Request - ${channelId}] ${authorName}: ${content}`);

    // 사용자 메시지를 보내고 모델의 응답 받기
    const response = await chat.sendMessage({
      message: `${authorName}: ${content}`
    });
    console.log(`[Response - ${channelId}] 바오: ${response.text}`);

    // 응답 형식
    const responseData = {
      status: "success",
      response: {
        text: response.text,
        timestamp: Date.now()
      }
    };

    res.status(200).json(responseData);
  } catch (error) {
    console.error("Error in /response endpoint:", error);
    res.status(500).json({ status: "error", message: error.message });
  }
});

// 채팅 기록 기반 챗봇 초기화
app.post("/revival", async (req, res) => {
  try {
    const { channelId, roomName, history } = req.body;

    if (!channelId || !history || !Array.isArray(history)) {
      return res.status(400).json({
        status: "error",
        message: "Invalid request format. channelId and history array are required."
      });
    }

    console.log(`Revival requested for channel: ${channelId}, room: ${roomName || 'Unknown'}`);
    console.log(`History size: ${history.length} messages`);

    const MAX_MESSAGES = 50;
    const relevantHistory = history.slice(-MAX_MESSAGES);

    const systemInstruction = `당신은 카카오톡 채팅방 "${roomName || '그룹'}"에서 동작하는 AI 챗봇입니다.
당신의 이름은 "바오"입니다. 친절하고 유용한 응답을 제공하세요.
사용자 메시지를 이해하고 맥락에 맞게 응답하세요.
질문에 답변하고 대화에 자연스럽게 참여하세요.`;

    const chatHistory = [];

    for (const msg of relevantHistory) {
      if (!msg.content || typeof msg.content !== 'string') continue;

      if (msg.authorName === '바오' || msg.authorHash === 'bao') { // '바오' 또는 특정 해시값으로 챗봇 메시지 식별
        chatHistory.push({
          role: "model",
          parts: [{ text: msg.content }]
        });
      } else {
        chatHistory.push({
          role: "user",
          parts: [{ text: `${msg.authorName || '사용자'}: ${msg.content}` }]
        });
      }
    }

    if (chatHistory.length === 0 || chatHistory[0].role === "model") {
      chatHistory.unshift({
        role: "user",
        parts: [{ text: "안녕하세요! 다시 돌아왔어요." }] // 좀 더 자연스러운 시작 메시지
      });
    }

    if (chatHistory.length > 0 && chatHistory[chatHistory.length - 1].role === "model") {
      // 마지막이 모델 응답이면, 다음 사용자 입력을 기다리는 것이 자연스러우므로 특별히 제거할 필요는 없습니다.
      // 하지만, 만약 마지막 모델 응답 후 사용자가 다시 말을 걸 차례로 만들고 싶다면 pop()을 사용할 수 있습니다.
      // chatHistory.pop(); 
    }

    console.log(`Initializing chat for ${channelId} with ${chatHistory.length} processed messages.`);
    channelChats[channelId] = ai.chats.create({
      model: "gemini-2.0-flash",
      config: {
        systemInstruction: systemInstruction,
        // ✨ Google Search를 도구로 추가 ✨
        tools: [{ googleSearch: {} }],
      },
      history: chatHistory
    });

    res.status(200).json({
      status: "success",
      message: `Successfully initialized chat for ${channelId} with ${chatHistory.length} messages from history.`,
      processed_messages: chatHistory.length
    });

  } catch (error) {
    console.error("Error in /revival endpoint:", error);
    res.status(500).json({
      status: "error",
      message: error.message
    });
  }
});

// 서버 시작
app.listen(port, '0.0.0.0', () => {
  console.log(`Gemini API server listening at http://0.0.0.0:${port}`);
});
