import { useState, useRef, useCallback, useEffect } from 'react';

// 모바일은 말 중간 쉬는 숨이 짧아도 끊기지 않도록 데스크탑보다 여유를 줌
const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const SILENCE_DELAY = isMobile ? 2500 : 1500;

export function useVoiceInput(onResult) {
  const [isListening, setIsListening] = useState(false);
  const [liveText, setLiveText] = useState('');
  const recognitionRef = useRef(null);
  const silenceTimerRef = useRef(null);
  const accumulatedRef = useRef('');
  const activeRef = useRef(false);
  const pausedRef = useRef(false);
  const onResultRef = useRef(onResult);
  const createAndStartRef = useRef(null);
  const generationRef = useRef(0);

  useEffect(() => { onResultRef.current = onResult; }, [onResult]);

  const createAndStart = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      alert('음성 인식이 지원되지 않습니다. Chrome 또는 Safari를 사용해주세요.');
      return;
    }

    const myGen = ++generationRef.current;
    // Per-instance tracker: prevents same final result being accumulated twice.
    // Some mobile Chrome versions fire onresult with the same resultIndex & isFinal=true twice.
    let lastFinalIndex = -1;

    const recognition = new SR();
    recognition.lang = 'ko-KR';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      if (!activeRef.current) return;
      if (generationRef.current !== myGen) return;
      if (pausedRef.current) return;

      clearTimeout(silenceTimerRef.current);

      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) {
          // Guard: only accumulate if this index hasn't been processed yet
          if (i > lastFinalIndex) {
            accumulatedRef.current += r[0].transcript;
            lastFinalIndex = i;
          }
        } else {
          interim += r[0].transcript;
        }
      }
      setLiveText(accumulatedRef.current + interim);

      // Always use SILENCE_DELAY — never cut speech mid-sentence
      silenceTimerRef.current = setTimeout(() => {
        if (generationRef.current !== myGen) return;
        if (pausedRef.current) return;
        // Use accumulated (final) text if available; fall back to interim only if no final came.
        // Never concatenate accumulated + interim — mobile Chrome echoes the last final segment
        // as a new interim result, which doubles the text (e.g. "안녕하세요안녕하세요").
        const full = accumulatedRef.current.trim() || interim.trim();
        accumulatedRef.current = '';
        setLiveText('');
        if (full) {
          pausedRef.current = true;
          recognition.stop();
          onResultRef.current(full);
        } else {
          recognition.stop();
        }
      }, SILENCE_DELAY);
    };

    recognition.onerror = (e) => {
      if (e.error === 'no-speech') return;
      if (generationRef.current !== myGen) return;
      clearTimeout(silenceTimerRef.current);
      activeRef.current = false;
      pausedRef.current = false;
      setIsListening(false);
      setLiveText('');
    };

    recognition.onend = () => {
      if (generationRef.current !== myGen) return;
      if (activeRef.current && !pausedRef.current) {
        setTimeout(() => {
          if (activeRef.current && !pausedRef.current && generationRef.current === myGen) {
            createAndStartRef.current?.();
          }
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

  const stop = useCallback(() => {
    clearTimeout(silenceTimerRef.current);
    generationRef.current++;
    activeRef.current = false;
    pausedRef.current = false;
    recognitionRef.current?.stop();
    setIsListening(false);
    setLiveText('');
    accumulatedRef.current = '';
  }, []);

  const start = useCallback(() => {
    if (activeRef.current) return;
    accumulatedRef.current = '';
    activeRef.current = true;
    pausedRef.current = false;
    createAndStart();
  }, [createAndStart]);

  const pause = useCallback(() => {
    pausedRef.current = true;
    clearTimeout(silenceTimerRef.current);
    recognitionRef.current?.stop();
  }, []);

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
