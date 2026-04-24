import { useState, useRef, useEffect, useCallback } from 'react';
import { useVoiceInput } from './useVoiceInput';
import { speak, stopSpeaking, getIsSpeaking } from '../services/ttsService';

// 모바일 여부 — speakThenResume의 resumeMic 지연 및 폴링 전략에 사용
const isMobileDevice = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

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
  const processingTimeoutRef = useRef(null); // 안전 타임아웃 핸들

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

  // ── speakThenResume ───────────────────────────────────────
  // TTS 재생이 완전히 끝난 뒤에만 마이크를 재개한다.
  // [데스크탑] safeEnd() → 800ms 후 resumeMic() — 기존 동작 유지
  // [모바일]  safeEnd() 후 getIsSpeaking() 폴링(300ms 간격)으로 실제 종료 재확인
  //           → false 확인 후 1000ms 추가 대기 → resumeMic() (잔향 소멸 여유)
  function speakThenResume(text) {
    if (ttsEnabledRef.current) {
      setTimeout(() => speak(text, personality, profile, () => {
        if (isMobileDevice) {
          const pollAndResume = () => {
            if (getIsSpeaking()) {
              setTimeout(pollAndResume, 300);
            } else {
              setTimeout(resumeMic, 1000);
            }
          };
          setTimeout(pollAndResume, 100);
        } else {
          setTimeout(resumeMic, 800);
        }
      }), 300);
    } else {
      resumeMic();
    }
  }

  async function sendMessage(text) {
    const isFromVoice = !!text;
    const rawMsg = text?.trim() || input.trim();
    if (!rawMsg || processingRef.current) return; // processingRef: React state보다 빠른 중복 차단
    processingRef.current = true;

    // 안전 타임아웃: 네트워크 오류 등으로 processingRef가 영구 잠금되는 것을 방지
    clearTimeout(processingTimeoutRef.current);
    processingTimeoutRef.current = setTimeout(() => {
      if (processingRef.current) {
        processingRef.current = false;
        setLoading(false);
        setError('응답 시간이 초과되었습니다. 다시 시도해주세요.');
        resumeMic();
      }
    }, 30000);

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
      clearTimeout(processingTimeoutRef.current);
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
