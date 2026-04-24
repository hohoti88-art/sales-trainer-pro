import { GoogleGenerativeAI } from '@google/generative-ai';

// gemini-2.5-flash "Thinking" is disabled via thinkingBudget:0 to prevent
// internal reasoning from leaking into response.text() (hallucination in UI).
const MODEL = 'gemini-2.5-flash';
const NO_THINKING = { thinkingConfig: { thinkingBudget: 0 } };

function extractText(result) {
  // Filter out thought-parts just in case (parts with thought:true are internal reasoning)
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
    return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
  }

  const { action, systemInstruction, history, message, prompt } = req.body;

  try {
    const genAI = new GoogleGenerativeAI(apiKey);

    if (action === 'chat') {
      const model = genAI.getGenerativeModel({
        model: MODEL,
        generationConfig: NO_THINKING,
        ...(systemInstruction && { systemInstruction }),
      });
      const chat = model.startChat({ history: history || [] });
      const result = await chat.sendMessage(message);
      return res.json({ text: extractText(result) });
    }

    if (action === 'generate') {
      const model = genAI.getGenerativeModel({
        model: MODEL,
        generationConfig: NO_THINKING,
      });
      const result = await model.generateContent(prompt);
      return res.json({ text: extractText(result) });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('Gemini proxy error:', err);
    return res.status(500).json({ error: err.message });
  }
}
