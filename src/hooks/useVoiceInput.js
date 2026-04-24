import { useState, useRef, useCallback, useEffect } from 'react';

// ── continuous: false 단일 발화 모드 ────────────────────────
//
// 기존 continuous: true + 재시작 루프 방식의 문제:
//   - 모바일 Chrome이 SpeechRecognition을 자주 강제 종료
//   - 재시작 시 lastFinalIndex 초기화 + accumulatedRef 유지 → 같은 텍스트 N배 누적
//   - VAD의 경쟁 getUserMedia가 재시작을 더 빈번하게 만듦
//
// 새 방식:
//   - continuous: false → Chrome이 발화 1회분 처리 후 자연 종료
//   - onend에서 최종 텍스트 제출 → 재시작 루프 없음
//   - no-speech → 조용히 새 세션 시작 (발화 대기 유지)
//   - Chrome 강제 종료(발화 없이 onend) → 새 세션 시작
//   - VAD 완전 제거 (경쟁 getUserMedia 없음)

export function useVoiceInput(onResult) {
  const [isListening, setIsListening] = useState(false);
  const [liveText, setLiveText]       = useState('');

  const recognitionRef     = useRef(null);
  const activeRef          = useRef(false);
  const pausedRef          = useRef(false);
  const onResultRef        = useRef(onResult);
  const createAndStartRef  = useRef(null);
  const generationRef      = useRef(0);
  const finalTextRef       = useRef('');     // onresult isFinal 텍스트 보관
  const retryScheduledRef  = useRef(false);  // no-speech 재시작 중복 방지

  useEffect(() => { onResultRef.current = onResult; }, [onResult]);

  const createAndStart = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      alert('음성 인식이 지원되지 않습니다. Chrome 또는 Safari를 사용해주세요.');
      return;
    }

    const myGen = ++generationRef.current;
    finalTextRef.current    = '';
    retryScheduledRef.current = false;

    const recognition = new SR();
    recognition.lang            = 'ko-KR';
    recognition.continuous      = false;  // 핵심: 1회 발화 후 자동 종료
    recognition.interimResults  = true;   // 실시간 텍스트 표시
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      if (!activeRef.current || generationRef.current !== myGen || pausedRef.current) return;

      let interim = '';
      let final   = '';
      for (let i = 0; i < event.results.length; i++) {
        if (event.results[i].isFinal) final   += event.results[i][0].transcript;
        else                          interim += event.results[i][0].transcript;
      }

      if (final) {
        // 확정 텍스트 → 보관 (실제 제출은 onend에서)
        finalTextRef.current = final;
        setLiveText(final);
      } else {
        setLiveText(interim);
      }
    };

    recognition.onerror = (e) => {
      if (generationRef.current !== myGen) return;

      if (e.error === 'no-speech') {
        // 발화 없음 → onend가 곧 발생하므로 플래그만 세우고 재시작 예약
        if (activeRef.current && !pausedRef.current) {
          retryScheduledRef.current = true;
          setTimeout(() => {
            if (activeRef.current && !pausedRef.current && generationRef.current === myGen) {
              createAndStartRef.current?.();
            }
          }, 200);
        }
        return;
      }

      // 그 외 오류 → 완전 정지
      activeRef.current  = false;
      pausedRef.current  = false;
      recognitionRef.current = null;
      setIsListening(false);
      setLiveText('');
    };

    recognition.onend = () => {
      if (generationRef.current !== myGen) return;
      recognitionRef.current = null;

      const text = finalTextRef.current.trim();
      finalTextRef.current = '';
      setLiveText('');

      if (text && !pausedRef.current) {
        // 발화 완료 → 제출
        pausedRef.current = true;
        setIsListening(false);
        onResultRef.current(text);
        return;
      }

      if (activeRef.current && !pausedRef.current && !retryScheduledRef.current) {
        // no-speech가 아닌 자연 종료(Chrome 자체 세션 만료 등) → 새 세션 시작
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

  // ── 공개 API ──────────────────────────────────────────────

  const stop = useCallback(() => {
    generationRef.current++;          // 진행 중인 모든 콜백 무효화
    activeRef.current  = false;
    pausedRef.current  = false;
    finalTextRef.current = '';
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setIsListening(false);
    setLiveText('');
  }, []);

  const start = useCallback(() => {
    if (activeRef.current) return;
    activeRef.current  = true;
    pausedRef.current  = false;
    finalTextRef.current = '';
    createAndStart();
  }, [createAndStart]);

  // AI 응답 중 마이크 일시정지 (TTS 재생 전 호출)
  const pause = useCallback(() => {
    pausedRef.current = true;
    recognitionRef.current?.stop();
  }, []);

  // AI 응답+TTS 완료 후 마이크 재개
  const resume = useCallback(() => {
    activeRef.current  = true;
    pausedRef.current  = false;
    finalTextRef.current = '';
    createAndStart();
  }, [createAndStart]);

  const toggle = useCallback(() => {
    if (activeRef.current) stop();
    else start();
  }, [stop, start]);

  return { isListening, liveText, toggle, start, stop, pause, resume };
}
