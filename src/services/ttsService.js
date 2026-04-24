const PERSONALITY_SETTINGS = {
  '까다로운형': { rate: 1.0,  pitch: 0.9 },
  '바쁜형':     { rate: 1.5,  pitch: 1.0 },
  '친절한형':   { rate: 1.15, pitch: 1.1 },
  '의심형':     { rate: 0.95, pitch: 0.85 },
};

const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

// <audio> element — plays through OS audio output pipeline.
// The browser's AEC (Acoustic Echo Cancellation) uses the OS output as its reference
// signal, so SpeechRecognition mic input is automatically subtracted from this audio.
// AudioContext.createBufferSource() can bypass that reference → echo. <audio> does not.
let currentAudioEl = null;

function detectGender(profile) {
  if (!profile) return null;
  if (/남성|남자/.test(profile)) return 'male';
  if (/여성|여자/.test(profile)) return 'female';
  return null;
}

function cleanText(text) {
  const cleaned = text
    .replace(/\([^)]*\)/g, '')
    .replace(/（[^）]*）/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (cleaned.length <= 300) return cleaned;
  const cut = cleaned.slice(0, 300);
  const lastPunct = Math.max(
    cut.lastIndexOf('.'), cut.lastIndexOf('!'), cut.lastIndexOf('?'),
    cut.lastIndexOf('。'), cut.lastIndexOf('요')
  );
  return lastPunct > 200 ? cut.slice(0, lastPunct + 1) : cut;
}

// ── Azure TTS ─────────────────────────────────────────────
async function speakAzure(cleaned, gender, safeEnd) {
  const res = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: cleaned, gender }),
  });
  if (!res.ok) throw new Error(`azure ${res.status}`);
  const { audio } = await res.json();

  const bytes = Uint8Array.from(atob(audio), c => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: 'audio/mpeg' });
  const url = URL.createObjectURL(blob);

  if (currentAudioEl) { currentAudioEl.pause(); currentAudioEl.src = ''; }
  const el = new Audio(url);
  currentAudioEl = el;

  await new Promise((resolve, reject) => {
    const cleanup = () => {
      URL.revokeObjectURL(url);
      if (currentAudioEl === el) currentAudioEl = null;
    };
    // 60s hard cap — should never fire for normal TTS but prevents zombie promises
    const fallback = setTimeout(() => { cleanup(); safeEnd(); resolve(); }, 60000);
    el.onended = () => { clearTimeout(fallback); cleanup(); safeEnd(); resolve(); };
    el.onerror = () => { clearTimeout(fallback); cleanup(); reject(new Error('audio error')); };
    el.play().catch(reject);
  });
}

// ── Web Speech API (폴백) ─────────────────────────────────
function getKoreanVoice(gender) {
  const voices = window.speechSynthesis.getVoices();
  const koVoices = voices.filter(v => v.lang.startsWith('ko'));
  if (koVoices.length === 0) return null;
  const neuralVoices = koVoices.filter(v => /neural/i.test(v.name));
  const isFemale = v => /SunHi|YuJin|여성|여자|female|woman|Heami/i.test(v.name);
  const isMaleVoice = v => /InJoon|남성|남자|male|man|Junho|Minjun/i.test(v.name);
  if (gender === 'male') {
    return neuralVoices.find(isMaleVoice) || koVoices.find(isMaleVoice) ||
           neuralVoices.find(v => !isFemale(v)) || koVoices[koVoices.length - 1];
  }
  if (gender === 'female') {
    return neuralVoices.find(isFemale) || neuralVoices[0] || koVoices.find(isFemale) || koVoices[0];
  }
  return neuralVoices[0] || koVoices[0];
}

function speakWebSpeech(cleaned, personality, gender, safeEnd) {
  if (!window.speechSynthesis) { safeEnd(); return; }
  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(cleaned);
  utterance.lang = 'ko-KR';
  const s = PERSONALITY_SETTINGS[personality] ?? { rate: 1.0, pitch: 1.0 };
  const genderPitch = gender === 'male' ? (isMobile ? 0.1 : 0.5) : gender === 'female' ? 1.2 : 1.0;
  utterance.rate = gender === 'male' ? 0.75 : s.rate;
  utterance.pitch = Math.min(2, Math.max(0.1, s.pitch * genderPitch));
  utterance.volume = 1.0;

  // Estimate based on text length — Web Speech has no reliable duration API
  const estimatedMs = Math.min(Math.max(cleaned.length * 80, 3000), 25000) + 3000;
  const fallbackTimer = setTimeout(safeEnd, estimatedMs);
  utterance.onend = () => { clearTimeout(fallbackTimer); safeEnd(); };
  utterance.onerror = () => { clearTimeout(fallbackTimer); safeEnd(); };

  const doSpeak = () => {
    const voice = getKoreanVoice(gender);
    if (voice) utterance.voice = voice;
    try { window.speechSynthesis.speak(utterance); } catch { clearTimeout(fallbackTimer); safeEnd(); return; }
    if (isIOS) {
      const w = setInterval(() => {
        if (!window.speechSynthesis.speaking) { clearInterval(w); return; }
        if (window.speechSynthesis.paused) window.speechSynthesis.resume();
      }, 250);
      setTimeout(() => clearInterval(w), estimatedMs);
    }
  };

  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) {
    let resolved = false;
    const resolveOnce = () => {
      if (resolved) return;
      resolved = true;
      window.speechSynthesis.onvoiceschanged = null;
      doSpeak();
    };
    window.speechSynthesis.onvoiceschanged = resolveOnce;
    setTimeout(resolveOnce, 1000);
  } else {
    doSpeak();
  }
}

// ── 공개 API ─────────────────────────────────────────────
export function speak(text, personality = '친절한형', profile = '', onEnd = null) {
  let ended = false;
  const safeEnd = () => { if (ended) return; ended = true; if (onEnd) onEnd(); };

  const cleaned = cleanText(text);
  if (!cleaned) { safeEnd(); return; }

  const gender = detectGender(profile);

  speakAzure(cleaned, gender, safeEnd).catch(() => {
    speakWebSpeech(cleaned, personality, gender, safeEnd);
  });
}

export function stopSpeaking() {
  if (currentAudioEl) {
    currentAudioEl.pause();
    currentAudioEl.src = '';
    currentAudioEl = null;
  }
  window.speechSynthesis?.cancel();
}

// 버튼 클릭(사용자 제스처)에서 호출 — <audio> autoplay + AEC + Web Speech 잠금 해제
export function unlockAudio() {
  // 1. <audio> autoplay 잠금 해제 — 모바일은 사용자 제스처 없이 재생 불가
  const warmup = new Audio();
  warmup.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
  warmup.volume = 0;
  warmup.play().catch(() => {});

  // 2. echoCancellation:true 로 getUserMedia 호출 → 브라우저 AEC 파이프라인 초기화
  //    이후 SpeechRecognition도 같은 오디오 디바이스에서 AEC 적용 혜택을 받음
  navigator.mediaDevices?.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  }).then(stream => {
    // 500ms 유지 후 해제 — AEC 엔진이 초기화될 시간 확보
    setTimeout(() => stream.getTracks().forEach(t => t.stop()), 500);
  }).catch(() => {});

  // 3. Web Speech API (폴백용) 잠금 해제
  if (window.speechSynthesis) {
    const u = new SpeechSynthesisUtterance('');
    u.volume = 0; u.rate = 10;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }
}

// 전화벨 (AudioContext 사용 — 벨소리는 AEC 에코 대상이 아님)
export function playRingTone(onEnd) {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) { if (onEnd) onEnd(); return; }
    const ctx = new AudioCtx();
    function burst(start, dur) {
      const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain();
      o1.frequency.value = 440; o2.frequency.value = 480;
      o1.connect(g); o2.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(0.18, start + 0.02);
      g.gain.setValueAtTime(0.18, start + dur - 0.03);
      g.gain.linearRampToValueAtTime(0, start + dur);
      o1.start(start); o1.stop(start + dur);
      o2.start(start); o2.stop(start + dur);
    }
    burst(ctx.currentTime, 0.4);
    burst(ctx.currentTime + 0.65, 0.4);
    setTimeout(() => { try { ctx.close(); } catch {} if (onEnd) onEnd(); }, 1300);
  } catch { if (onEnd) onEnd(); }
}
