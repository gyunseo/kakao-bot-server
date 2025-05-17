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
app.use(express.json({ limit: '10mb' }));  // 큰 채팅 기록을 처리하기 위해 제한 증가

// 디버깅을 위한 로깅 미들웨어
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  console.log('Headers:', JSON.stringify(req.headers));
  console.log('Body type:', typeof req.body);
  if (req.url !== '/revival') {  // /revival은 너무 커서 전체 로깅하지 않음
    console.log('Raw body:', req.body);
  } else {
    console.log('Revival request received for channelId:', req.body.channelId);
  }
  next();
});

// 채팅방에 대한 채팅 인스턴스를 가져오거나 생성
function getOrCreateChat(channelId) {
  if (!channelChats[channelId]) {
    channelChats[channelId] = ai.chats.create({
      model: "gemini-2.0-flash",
      config: {
        systemInstruction: "당신은 카카오톡 채팅방에서 동작하는 AI 챗봇입니다.\n당신의 이름은 '바오'입니다. 친절하고 유용한 응답을 제공하세요.\n사용자 메시지를 이해하고 맥락에 맞게 응답하세요.\n질문에 답변하고 대화에 자연스럽게 참여하세요."
      },
      history: []
    });
  }
  return channelChats[channelId];
}

// 대화 기록에 메시지 추가 (응답 없음)
app.post("/feed", async (req, res) => {
  try {
    console.log("Request body:", JSON.stringify(req.body));
    const { authorName = "사용자", content = "", channelId = "default", timestamp } = req.body;
    const chat = getOrCreateChat(channelId);
    console.log(`${authorName || "사용자"}: ${content || "메시지 없음"}`);
    // 사용자 메시지를 채팅 모델에 피드
    const response = await chat.sendMessage({
      message: `${authorName || "사용자"}: ${content || "메시지 없음"}`
    });
    console.log(response.text);
    
    res.status(200).json({ status: "success", message: "Message received" });
  } catch (error) {
    console.error("Error in /feed endpoint:", error);
    res.status(500).json({ status: "error", message: error.message });
  }
});

// 대화 응답 받기
app.post("/response", async (req, res) => {
  try {
    console.log("Request body:", JSON.stringify(req.body));
    const { authorName = "사용자", content = "", channelId = "default", timestamp } = req.body;
    const chat = getOrCreateChat(channelId);
    console.log(`${authorName || "사용자"}: ${content || "메시지 없음"}`);
    // 사용자 메시지를 보내고 모델의 응답 받기
    const response = await chat.sendMessage({
      message: `${authorName || "사용자"}: ${content || "메시지 없음"}`
    });
    console.log(response.text);
    
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
    
    // 최대 처리할 메시지 수 (너무 많으면 토큰 제한에 걸릴 수 있음)
    const MAX_MESSAGES = 50;
    // 최근 메시지를 우선 처리
    const relevantHistory = history.slice(-MAX_MESSAGES);
    
    // 시스템 지시문 설정
    const systemInstruction = `당신은 카카오톡 채팅방 "${roomName || '그룹'}"에서 동작하는 AI 챗봇입니다.
당신의 이름은 "바오"입니다. 친절하고 유용한 응답을 제공하세요.
사용자 메시지를 이해하고 맥락에 맞게 응답하세요.
질문에 답변하고 대화에 자연스럽게 참여하세요.`;
    
    // 새 채팅 인스턴스 생성
    const chatHistory = [];
    
    // 기록에서 챗봇과 사용자 메시지 구분하여 추가
    for (const msg of relevantHistory) {
      if (!msg.content || typeof msg.content !== 'string') continue;
      
      // 바오(챗봇)의 메시지인지 확인
      if (msg.authorName === '바오' || msg.authorHash === 'bao') {
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
    
    // 히스토리가 비어있거나 model 턴으로 시작하는 경우 처리
    if (chatHistory.length === 0 || chatHistory[0].role === "model") {
      // 시작 메시지 추가
      chatHistory.unshift({
        role: "user",
        parts: [{ text: "안녕하세요" }]
      });
    }
    
    // 히스토리가 model 턴으로 끝나는 경우도 처리
    if (chatHistory.length > 0 && chatHistory[chatHistory.length - 1].role === "model") {
      // 마지막 model 턴 제거 (다음 user 입력에 따라 새 응답 생성)
      chatHistory.pop();
    }
    
    // 채팅 인스턴스 생성 또는 업데이트
    channelChats[channelId] = ai.chats.create({
      model: "gemini-2.0-flash",
      config: {
        systemInstruction: systemInstruction
      },
      history: chatHistory
    });
    
    res.status(200).json({ 
      status: "success", 
      message: `Successfully initialized chat with ${chatHistory.length} messages from history`,
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