import { GoogleGenerativeAI } from '@google/generative-ai';

// 신규 계정은 gemini-2.5-flash만 사용 가능 (1.5·2.0은 신규 계정 접근 불가)
// thinkingBudget:0 — 내부 추론이 response.text()에 노출되는 문제 방지
const MODEL = 'gemini-2.5-flash';
const NO_THINKING = { thinkingConfig: { thinkingBudget: 0 } };

function extractText(result) {
  const parts = result.response?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    const text = parts.filter(p => !p.thought).map(p => p.text || '').join('');
    if (text.trim()) return text;
  }
  return result.response.text();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY가 Vercel 환경변수에 설정되지 않았습니다' });
  }

  const { action, systemInstruction, history, message, prompt } = req.body || {};
  if (action !== 'chat' && action !== 'generate') {
    return res.status(400).json({ error: 'Unknown action' });
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const modelOpts = {
      model: MODEL,
      generationConfig: NO_THINKING,
      ...(systemInstruction && { systemInstruction }),
    };

    let text;
    if (action === 'chat') {
      const model = genAI.getGenerativeModel(modelOpts);
      const chat = model.startChat({ history: history || [] });
      const result = await chat.sendMessage(message);
      text = extractText(result);
    } else {
      const model = genAI.getGenerativeModel({ model: MODEL, generationConfig: NO_THINKING });
      const result = await model.generateContent(prompt);
      text = extractText(result);
    }

    return res.json({ text });
  } catch (err) {
    console.error('Gemini API error:', err.message);
    // 403 = API 키 권한 문제, 상세 메시지를 그대로 반환
    return res.status(500).json({ error: err.message });
  }
}
