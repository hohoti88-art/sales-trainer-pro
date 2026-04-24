import { useState, useRef, useEffect, useCallback } from 'react';
import { useVoiceInput } from './useVoiceInput';
import { speak, stopSpeaking } from '../services/ttsService';

export function useVoiceChat({ chatRef, product, profile, personality, ttsStorageKey, defaultTts = false }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [ttsEnabled, setTtsEnabled] = useState(() => {
    const stored = localStorage.getItem(ttsStorageKey);
    return defaultTts ? stored !== 'false' : stored === 'true';
  });

  const ttsEnabledRef = useRef(ttsEnabled);
  const sendMessageRef = useRef(null);
  const processingRef = useRef(false); // 동시 sendMessage 호출 차단 (React state보다 빠른 동기 가드)

  useEffect(() => { ttsEnabledRef.current = ttsEnabled; }, [ttsEnabled]);

  const handleVoiceResult = useCallback((text) => {
    // TTS ON/OFF 무관하게 항상 sendMessage — 음성 입력은 항상 자동 전송
    if (sendMessageRef.current) {
      sendMessageRef.current(text);
    }
  }, []);

  const {
    isListening, liveText,
    toggle: _toggleMic,
    start: startMic,
    stop: stopMic,
    pause: pauseMic,
    resume: resumeMic,
  } = useVoiceInput(handleVoiceResult);

  const toggleMic = useCallback(() => {
    stopSpeaking();
    _toggleMic();
  }, [_toggleMic]);

  function toggleTts() {
    setTtsEnabled(prev => {
      const next = !prev;
      localStorage.setItem(ttsStorageKey, String(next));
      if (!next) stopSpeaking();
      return next;
    });
  }

  function speakThenResume(text) {
    if (ttsEnabledRef.current) {
      // 300ms 대기 후 speak — recognition.stop() 완전 종료 보장
      // onEnd 후 1000ms 대기 — <audio> AEC가 정착할 시간 + 잔향 소멸 여유
      setTimeout(() => speak(text, personality, profile, () => setTimeout(resumeMic, 1000)), 300);
    } else {
      resumeMic();
    }
  }

  async function sendMessage(text) {
    const isFromVoice = !!text;
    const rawMsg = text?.trim() || input.trim();
    if (!rawMsg || processingRef.current) return; // processingRef: React state보다 빠른 중복 차단
    processingRef.current = true;

    setInput('');
    stopSpeaking();
    pauseMic(); // 항상 정지 — TTS OFF여도 새 인스턴스 충돌 방지
    setLoading(true);

    try {
      let userMsg = rawMsg;

      // 발화 즉시 화면에 표시 (글자 멈춤 방지)
      const msgId = Date.now();
      setMessages(prev => [...prev, { role: 'user', text: rawMsg, _id: msgId }]);

      setMessages(prev => prev.map(m => m._id === msgId ? { ...m, _id: undefined } : m));

      const result = await chatRef.current.sendMessage(userMsg);
      const rawAi = result.response.text();
      const aiText = rawAi
        .replace(/\([^)]*\)/g, '')
        .replace(/（[^）]*）/g, '')
        .replace(/\[[^\]]*\]/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim();

      // 실제 사람이 듣고 생각하는 자연스러운 텀 (너무 빠르면 대화가 부자연스러움)
      const delay = isFromVoice ? 800 + Math.random() * 600 : 600 + Math.random() * 500;
      await new Promise(r => setTimeout(r, delay));

      setMessages(prev => [...prev, { role: 'model', text: aiText }]);

      speakThenResume(aiText);
    } catch (e) {
      setError('응답 오류: ' + e.message);
      resumeMic();
    } finally {
      setLoading(false);
      processingRef.current = false;
    }
  }

  sendMessageRef.current = sendMessage;

  return {
    messages, setMessages,
    input, setInput,
    loading, error, setError,
    ttsEnabled, toggleTts,
    isListening, liveText,
    toggleMic, startMic, stopMic, speakThenResume,
    sendMessage,
  };
}
