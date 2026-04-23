const PERSONALITY_SETTINGS = {
  '까다로운형': { rate: 1.0,  pitch: 0.9 },
  '바쁜형':     { rate: 1.5,  pitch: 1.0 },
  '친절한형':   { rate: 1.15, pitch: 1.1 },
  '의심형':     { rate: 0.95, pitch: 0.85 },
};

function detectGender(profile) {
  if (!profile) return null;
  if (/남성|남자/.test(profile)) return 'male';
  if (/여성|여자/.test(profile)) return 'female';
  return null;
}

function getKoreanVoice(gender) {
  const voices = window.speechSynthesis.getVoices();
  const koVoices = voices.filter(v => v.lang.startsWith('ko'));
  if (koVoices.length === 0) return null;

  // Microsoft Neural voices are most natural-sounding
  const neuralVoices = koVoices.filter(v => /neural/i.test(v.name));

  if (gender === 'male') {
    // InJoon = Microsoft 남성 한국어 Neural 목소리 (SunHi는 여성이므로 제외)
    return (
      neuralVoices.find(v => /InJoon|남성|남자|male|man/i.test(v.name)) ||
      neuralVoices.find(v => !/SunHi|YuJin|female|여성|여자|woman/i.test(v.name)) ||
      koVoices.find(v => /male|남성|남자|man/i.test(v.name)) ||
      koVoices[koVoices.length - 1]
    );
  }
  if (gender === 'female') {
    // SunHi, YuJin = Microsoft 여성 한국어 Neural 목소리
    return (
      neuralVoices.find(v => /SunHi|YuJin|여성|여자|female|woman/i.test(v.name)) ||
      neuralVoices[0] ||
      koVoices.find(v => /female|여성|여자|woman/i.test(v.name)) ||
      koVoices[0]
    );
  }
  return neuralVoices[0] || koVoices[0];
}

function cleanText(text) {
  // 괄호 안 지문 제거 (한글/영문 괄호 모두)
  return text
    .replace(/\([^)]*\)/g, '')
    .replace(/（[^）]*）/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function speak(text, personality = '친절한형', profile = '', onEnd = null) {
  if (!window.speechSynthesis) {
    if (onEnd) onEnd();
    return;
  }
  window.speechSynthesis.cancel();

  const cleaned = cleanText(text);
  if (!cleaned) {
    if (onEnd) onEnd();
    return;
  }

  const utterance = new SpeechSynthesisUtterance(cleaned);
  utterance.lang = 'ko-KR';

  const s = PERSONALITY_SETTINGS[personality] ?? { rate: 1.0, pitch: 1.0 };
  const gender = detectGender(profile);

  const genderPitch = gender === 'male' ? 0.85 : gender === 'female' ? 1.1 : 1.0;
  utterance.rate = s.rate;
  utterance.pitch = s.pitch * genderPitch;
  utterance.volume = 1.0;

  utterance.onend = () => { if (onEnd) onEnd(); };
  utterance.onerror = () => { if (onEnd) onEnd(); };

  const doSpeak = () => {
    const voice = getKoreanVoice(gender);
    if (voice) utterance.voice = voice;
    window.speechSynthesis.speak(utterance);
  };

  if (window.speechSynthesis.getVoices().length === 0) {
    window.speechSynthesis.onvoiceschanged = () => {
      window.speechSynthesis.onvoiceschanged = null;
      doSpeak();
    };
  } else {
    doSpeak();
  }
}

export function stopSpeaking() {
  window.speechSynthesis?.cancel();
}

// 전화벨 소리 (Web Audio API)
export function playRingTone(onEnd) {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) { if (onEnd) onEnd(); return; }

    const ctx = new AudioCtx();

    function burst(start, dur) {
      const o1 = ctx.createOscillator();
      const o2 = ctx.createOscillator();
      const g  = ctx.createGain();
      o1.frequency.value = 440;
      o2.frequency.value = 480;
      o1.connect(g); o2.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(0.18, start + 0.02);
      g.gain.setValueAtTime(0.18, start + dur - 0.03);
      g.gain.linearRampToValueAtTime(0, start + dur);
      o1.start(start); o1.stop(start + dur);
      o2.start(start); o2.stop(start + dur);
    }

    // 뚜르르… 뚜르르… (0.4s + 0.2s gap + 0.4s)
    burst(ctx.currentTime,        0.4);
    burst(ctx.currentTime + 0.65, 0.4);

    setTimeout(() => {
      try { ctx.close(); } catch {}
      if (onEnd) onEnd();
    }, 1300);
  } catch {
    if (onEnd) onEnd();
  }
}
