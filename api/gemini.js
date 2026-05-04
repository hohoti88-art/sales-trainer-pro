import { GoogleGenerativeAI } from '@google/generative-ai';

// Model fallback chain: 2.5-flash → 2.0-flash → 1.5-flash
// Thinking disabled on 2.5-flash to prevent reasoning leaking into response.text()
const MODELS = [
  { name: 'gemini-2.5-flash', config: { thinkingConfig: { thinkingBudget: 0 } } },
  { name: 'gemini-2.0-flash', config: {} },
  { name: 'gemini-1.5-flash', config: {} },
];

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

  const genAI = new GoogleGenerativeAI(apiKey);
  let lastErr;

  for (const { name, config } of MODELS) {
    try {
      const text = await tryModel(genAI, name, config, systemInstruction, action, req.body);
      return res.json({ text });
    } catch (err) {
      console.warn(`${name} failed:`, err.message);
      lastErr = err;
    }
  }

  console.error('All Gemini models failed:', lastErr?.message);
  return res.status(500).json({ error: lastErr?.message || 'Gemini API error' });
}
