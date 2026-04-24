import { GoogleGenerativeAI } from '@google/generative-ai';

// gemini-2.5-flash "Thinking" is disabled via thinkingBudget:0 to prevent
// internal reasoning from leaking into response.text() (hallucination in UI).
// Fallback: gemini-2.0-flash (wider availability, no thinkingBudget needed)
const MODEL_PRIMARY  = 'gemini-2.5-flash';
const MODEL_FALLBACK = 'gemini-2.0-flash';
const NO_THINKING = { thinkingConfig: { thinkingBudget: 0 } };

function extractText(result) {
  const parts = result.response?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    const text = parts.filter(p => !p.thought).map(p => p.text || '').join('');
    if (text.trim()) return text;
  }
  return result.response.text();
}

async function tryModel(genAI, modelName, generationConfig, systemInstruction, action, body) {
  const { history, message, prompt } = body;
  const modelOpts = {
    model: modelName,
    generationConfig,
    ...(systemInstruction && { systemInstruction }),
  };

  if (action === 'chat') {
    const model = genAI.getGenerativeModel(modelOpts);
    const chat = model.startChat({ history: history || [] });
    const result = await chat.sendMessage(message);
    return extractText(result);
  }

  if (action === 'generate') {
    const model = genAI.getGenerativeModel({ model: modelName, generationConfig });
    const result = await model.generateContent(prompt);
    return extractText(result);
  }

  throw new Error('Unknown action');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
  }

  const { action, systemInstruction } = req.body;
  if (action !== 'chat' && action !== 'generate') {
    return res.status(400).json({ error: 'Unknown action' });
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);

    let text;
    try {
      // 1차: gemini-2.5-flash (thinkingBudget:0)
      text = await tryModel(genAI, MODEL_PRIMARY, NO_THINKING, systemInstruction, action, req.body);
    } catch (primaryErr) {
      console.warn('gemini-2.5-flash failed, falling back to gemini-2.0-flash:', primaryErr.message);
      // 2차: gemini-2.0-flash (thinkingBudget 없음 — 지원 안 함)
      text = await tryModel(genAI, MODEL_FALLBACK, {}, systemInstruction, action, req.body);
    }

    return res.json({ text });
  } catch (err) {
    console.error('Gemini proxy error:', err);
    return res.status(500).json({ error: err.message });
  }
}
