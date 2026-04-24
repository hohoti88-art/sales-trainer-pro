export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { text, gender } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });

  const key = process.env.AZURE_TTS_KEY;
  const region = process.env.AZURE_TTS_REGION || 'koreacentral';

  if (!key) return res.status(503).json({ error: 'TTS not configured' });

  const voiceName = gender === 'male' ? 'ko-KR-InJoonNeural' : 'ko-KR-SunHiNeural';
  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="ko-KR"><voice name="${voiceName}">${escapeXml(text)}</voice></speak>`;

  try {
    const azureRes = await fetch(
      `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`,
      {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': key,
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3',
        },
        body: ssml,
      }
    );

    if (!azureRes.ok) {
      const errText = await azureRes.text().catch(() => '');
      const errCode = azureRes.headers.get('x-ms-error-code') || '';
      console.error(`Azure TTS error: ${azureRes.status} code=${errCode} body=${errText.slice(0, 200)}`);
      return res.status(500).json({ error: `Azure ${azureRes.status} reason=${errCode} body=${errText.slice(0, 200)}` });
    }

    const arrayBuffer = await azureRes.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    res.status(200).json({ audio: base64 });
  } catch (err) {
    console.error('Azure TTS fetch error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
