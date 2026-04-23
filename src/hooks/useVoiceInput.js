import { useState, useRef, useCallback, useEffect } from 'react';

const SILENCE_DELAY = 1500;

export function useVoiceInput(onResult) {
  const [isListening, setIsListening] = useState(false);
  const [liveText, setLiveText] = useState('');
  const recognitionRef = useRef(null);
  const silenceTimerRef = useRef(null);
  const accumulatedRef = useRef('');
  const activeRef = useRef(false);   // 세션 활성 여부 (사용자가 마이크 ON 상태)
  const pausedRef = useRef(false);   // TTS 재생 중 일시정지 여부
  const onResultRef = useRef(onResult);
  const createAndStartRef = useRef(null);

  useEffect(() => { onResultRef.current = onResult; }, [onResult]);

  const createAndStart = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      alert('음성 인식이 지원되지 않습니다. Chrome 또는 Edge를 사용해주세요.');
      return;
    }

    const recognition = new SR();
    recognition.lang = 'ko-KR';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      // 핵심 수정: 세션이 종료된 후 Chrome이 늦게 보내는 이벤트 차단 → 중복 발화 방지
      if (!activeRef.current) return;

      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) accumulatedRef.current += r[0].transcript;
        else interim += r[0].transcript;
      }
      setLiveText(accumulatedRef.current + interim);

      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = setTimeout(() => {
        const full = (accumulatedRef.current + interim).trim();
        accumulatedRef.current = '';
        setLiveText('');
        if (full) onResultRef.current(full); // 콜백 호출 (sendMessage 등)
        recognition.stop();
      }, SILENCE_DELAY);
    };

    recognition.onerror = (e) => {
      if (e.error === 'no-speech') return;
      clearTimeout(silenceTimerRef.current);
      activeRef.current = false;
      pausedRef.current = false;
      setIsListening(false);
      setLiveText('');
    };

    recognition.onend = () => {
      // activeRef=true이고 pausedRef=false일 때만 재시작
      // → Chrome 강제 종료 대응 O, TTS 중 일시정지 상태 재시작 X
      if (activeRef.current && !pausedRef.current) {
        setTimeout(() => {
          if (activeRef.current && !pausedRef.current) createAndStartRef.current?.();
        }, 100);
      }
    };

    try {
      recognition.start();
      recognitionRef.current = recognition;
      setIsListening(true);
    } catch {
      activeRef.current = false;
      setIsListening(false);
    }
  }, []);

  createAndStartRef.current = createAndStart;

  // 완전 종료 (마이크 버튼으로 OFF)
  const stop = useCallback(() => {
    clearTimeout(silenceTimerRef.current);
    activeRef.current = false;
    pausedRef.current = false;
    recognitionRef.current?.stop();
    setIsListening(false);
    setLiveText('');
    accumulatedRef.current = '';
  }, []);

  // 세션 시작 (마이크 버튼으로 ON)
  const start = useCallback(() => {
    if (activeRef.current) return;
    accumulatedRef.current = '';
    activeRef.current = true;
    pausedRef.current = false;
    createAndStart();
  }, [createAndStart]);

  // TTS 재생 중 일시정지 (isListening 시각 상태 유지 — 마이크 버튼 계속 빨간색)
  const pause = useCallback(() => {
    pausedRef.current = true;
    clearTimeout(silenceTimerRef.current);
    recognitionRef.current?.stop();
  }, []);

  // TTS 종료 후 재개 (세션이 없어도 강제 시작 — 채팅 시작 시 자동 마이크 ON)
  const resume = useCallback(() => {
    activeRef.current = true;
    pausedRef.current = false;
    accumulatedRef.current = '';
    createAndStart();
  }, [createAndStart]);

  const toggle = useCallback(() => {
    if (activeRef.current) stop();
    else start();
  }, [stop, start]);

  return { isListening, liveText, toggle, start, stop, pause, resume };
}
