// api/stt.js — Vercel Serverless Function
// OpenAI Whisper STT 프록시: { audio: base64, mimeType } → { text }
// 모델: gpt-4o-mini-transcribe (한국어 정확도 최상)

export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'OPENAI_API_KEY is not configured' });
  }

  const { audio, mimeType = 'audio/webm', contextPrompt = '' } = req.body || {};
  if (!audio) return res.status(400).json({ error: 'audio is required' });

  // base64 → Buffer
  const audioBuffer = Buffer.from(audio, 'base64');

  // 파일명 확장자 결정 (OpenAI는 확장자로 형식 판단)
  const ext = mimeType.includes('mp4') || mimeType.includes('m4a')
    ? 'm4a'
    : mimeType.includes('ogg')
    ? 'ogg'
    : mimeType.includes('wav')
    ? 'wav'
    : 'webm';

  // FormData 구성 (Node.js 환경)
  const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
  const CRLF = '\r\n';

  const parts = [];

  // file part
  const fileHeader = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="audio.${ext}"`,
    `Content-Type: ${mimeType}`,
    '',
    '',
  ].join(CRLF);
  parts.push(Buffer.from(fileHeader));
  parts.push(audioBuffer);
  parts.push(Buffer.from(CRLF));

  // model part
  const modelPart = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="model"',
    '',
    'gpt-4o-mini-transcribe',
    '',
  ].join(CRLF);
  parts.push(Buffer.from(modelPart));

  // language part
  const langPart = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="language"',
    '',
    'ko',
    '',
  ].join(CRLF);
  parts.push(Buffer.from(langPart));

  // prompt part — 상품명·대화 맥락 힌트로 오인식 방지
  if (contextPrompt) {
    const promptPart = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="prompt"',
      '',
      contextPrompt.slice(0, 500), // Whisper 최대 허용 길이
      '',
    ].join(CRLF);
    parts.push(Buffer.from(promptPart));
  }

  // closing boundary
  parts.push(Buffer.from(`--${boundary}--${CRLF}`));

  const body = Buffer.concat(parts);

  try {
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
      body,
    });

    if (!response.ok) {
      const errBody = await response.text();
      return res.status(response.status).json({ error: `OpenAI STT 오류: ${errBody}` });
    }

    const data = await response.json();
    const text = (data.text || '').trim();
    return res.json({ text });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
