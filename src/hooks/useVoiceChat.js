import { useState, useRef, useEffect, useCallback } from 'react';
import { useVoiceInput } from './useVoiceInput';
import { speak, stopSpeaking } from '../services/ttsService';
import { correctVoiceTranscript } from '../services/geminiService';

/**
 * 화법연습·전화연습 공통 음성 대화 로직
 * - TTS 모드: 마이크 ON 후 대화가 자동으로 계속 이어짐
 * - 음성 교정: 고유명사(회사명·상품명) 오인식 자동 수정
 * - 이중 발화 방지: activeRef 가드 + pause/resume 메커니즘
 */
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

  useEffect(() => { ttsEnabledRef.current = ttsEnabled; }, [ttsEnabled]);

  // 음성 인식 결과 → TTS 모드면 자동 전송, 아니면 입력창에 세팅
  const handleVoiceResult = useCallback((text) => {
    if (ttsEnabledRef.current && sendMessageRef.current) {
      sendMessageRef.current(text);
    } else {
      setInput(text);
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

  // TTS ON이면 재생 후 마이크 재개, OFF면 즉시 마이크 재개
  function speakThenResume(text) {
    if (ttsEnabledRef.current) {
      speak(text, personality, profile, () => resumeMic());
    } else {
      resumeMic();
    }
  }

  async function sendMessage(text) {
    const isFromVoice = !!text;
    const rawMsg = text?.trim() || input.trim();
    if (!rawMsg || loading) return;

    setInput('');
    stopSpeaking();
    pauseMic(); // 항상 정지 — TTS OFF여도 새 인스턴스 충돌 방지
    setLoading(true);

    try {
      let userMsg = rawMsg;

      if (isFromVoice) {
        // 고유명사 교정과 자연스러운 대기를 병렬 실행 (추가 지연 없음)
        const context = `판매 상품: ${product}, 고객 프로필: ${profile}`;
        const [corrected] = await Promise.all([
          Promise.race([
            correctVoiceTranscript(rawMsg, context),
            new Promise(r => setTimeout(() => r(rawMsg), 600)),
          ]).catch(() => rawMsg),
          new Promise(r => setTimeout(r, 400 + Math.random() * 400)),
        ]);
        userMsg = corrected;
      }

      setMessages(prev => [...prev, { role: 'user', text: userMsg }]);

      const result = await chatRef.current.sendMessage(userMsg);
      const rawAi = result.response.text();
      // 괄호 지문 제거: (속으로 생각: ...) 등 AI가 생성하는 무대 지시문 차단
      const aiText = rawAi
        .replace(/\([^)]*\)/g, '')
        .replace(/（[^）]*）/g, '')
        .replace(/\[[^\]]*\]/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim();

      // 고객이 듣고 생각하는 자연스러운 텀
      const delay = isFromVoice ? 150 + Math.random() * 200 : 400 + Math.random() * 400;
      await new Promise(r => setTimeout(r, delay));

      setMessages(prev => [...prev, { role: 'model', text: aiText }]);

      speakThenResume(aiText); // TTS ON: 재생→마이크 재개 / OFF: 즉시 마이크 재개
    } catch (e) {
      setError('응답 오류: ' + e.message);
      resumeMic();
    } finally {
      setLoading(false);
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
