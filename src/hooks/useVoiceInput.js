import { useState, useRef, useCallback, useEffect } from 'react';

// ── continuous: false + 침묵 대기 누적 모드 ──────────────────
//
// [문제] continuous: false 단독 사용 시:
//   - Chrome이 짧은 숨 고르기(~1s)만 있어도 발화 완료로 판단 → 문장 중간 끊김
//
// [해결] 침묵 대기(SILENCE_TIMEOUT) 누적 방식:
//   - onend에서 즉시 제출하지 않고 accumulatedRef에 텍스트 누적
//   - SILENCE_TIMEOUT(1500ms) 동안 추가 발화 없으면 제출
//   - 추가 발화가 감지되면 타이머 리셋 → 계속 누적
//   - no-speech 발생해도 누적 텍스트 있으면 타이머 유지
//
// [에코 방지] continuous: false 유지 (continuous: true + 재시작 루프는
//   모바일에서 같은 텍스트 N배 누적 문제 발생)

const SILENCE_TIMEOUT = 1500; // 발화 후 이 시간(ms) 동안 침묵하면 제출

export function useVoiceInput(onResult) {
  const [isListening, setIsListening] = useState(false);
  const [liveText, setLiveText]       = useState('');

  const recognitionRef     = useRef(null);
  const activeRef          = useRef(false);
  const pausedRef          = useRef(false);
  const onResultRef        = useRef(onResult);
  const createAndStartRef  = useRef(null);
  const generationRef      = useRef(0);
  const finalTextRef       = useRef('');      // 현재 SR 세션의 isFinal 텍스트
  const accumulatedRef     = useRef('');      // 여러 세션에 걸쳐 누적된 텍스트
  const submitTimerRef     = useRef(null);    // 침묵 대기 타이머
  const retryScheduledRef  = useRef(false);   // no-speech 재시작 중복 방지

  useEffect(() => { onResultRef.current = onResult; }, [onResult]);

  // 누적 텍스트를 제출하고 상태 초기화
  const flushAccumulated = useCallback(() => {
    clearTimeout(submitTimerRef.current);
    const text = accumulatedRef.current.trim();
    accumulatedRef.current = '';
    setLiveText('');
    if (text && activeRef.current && !pausedRef.current) {
      pausedRef.current = true;
      setIsListening(false);
      onResultRef.current(text);
    }
  }, []);

  // 침묵 타이머 리셋 — 발화가 추가될 때마다 호출
  const resetSubmitTimer = useCallback(() => {
    clearTimeout(submitTimerRef.current);
    submitTimerRef.current = setTimeout(flushAccumulated, SILENCE_TIMEOUT);
  }, [flushAccumulated]);

  const createAndStart = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      alert('음성 인식이 지원되지 않습니다. Chrome 또는 Safari를 사용해주세요.');
      return;
    }

    const myGen = ++generationRef.current;
    finalTextRef.current   = '';
    retryScheduledRef.current = false;

    const recognition = new SR();
    recognition.lang            = 'ko-KR';
    recognition.continuous      = false;  // 1회 발화 후 자동 종료 (에코 방지)
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
        finalTextRef.current = final;
        // 누적 텍스트 + 현재 확정 텍스트를 합쳐서 표시
        setLiveText((accumulatedRef.current ? accumulatedRef.current + ' ' : '') + final);
      } else {
        setLiveText((accumulatedRef.current ? accumulatedRef.current + ' ' : '') + interim);
      }
    };

    recognition.onerror = (e) => {
      if (generationRef.current !== myGen) return;

      if (e.error === 'no-speech') {
        // 발화 없음 → 누적 텍스트가 있으면 타이머가 알아서 제출
        // 없으면 새 세션 시작해서 계속 대기
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
      clearTimeout(submitTimerRef.current);
      accumulatedRef.current = '';
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

      if (text && !pausedRef.current) {
        // 새 발화 감지 → 누적 후 침묵 타이머 리셋
        accumulatedRef.current = accumulatedRef.current
          ? accumulatedRef.current + ' ' + text
          : text;

        // 타이머 리셋: SILENCE_TIMEOUT 동안 추가 발화 없으면 제출
        resetSubmitTimer();

        // 계속 듣기 — 추가 발화 대기
        if (activeRef.current && !pausedRef.current) {
          setTimeout(() => {
            if (activeRef.current && !pausedRef.current) {
              createAndStartRef.current?.();
            }
          }, 80);
        }
        return;
      }

      // 이번 세션에 발화 없음 (no-speech 또는 자연 종료)
      if (activeRef.current && !pausedRef.current && !retryScheduledRef.current) {
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
  }, [resetSubmitTimer]);

  createAndStartRef.current = createAndStart;

  // ── 공개 API ──────────────────────────────────────────────

  const stop = useCallback(() => {
    clearTimeout(submitTimerRef.current);
    generationRef.current++;          // 진행 중인 모든 콜백 무효화
    activeRef.current    = false;
    pausedRef.current    = false;
    finalTextRef.current = '';
    accumulatedRef.current = '';
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setIsListening(false);
    setLiveText('');
  }, []);

  const start = useCallback(() => {
    if (activeRef.current) return;
    clearTimeout(submitTimerRef.current);
    accumulatedRef.current = '';
    activeRef.current  = true;
    pausedRef.current  = false;
    finalTextRef.current = '';
    createAndStart();
  }, [createAndStart]);

  // AI 응답 중 마이크 일시정지 (TTS 재생 전 호출)
  const pause = useCallback(() => {
    clearTimeout(submitTimerRef.current);
    accumulatedRef.current = '';
    pausedRef.current = true;
    recognitionRef.current?.stop();
  }, []);

  // AI 응답+TTS 완료 후 마이크 재개
  const resume = useCallback(() => {
    clearTimeout(submitTimerRef.current);
    accumulatedRef.current = '';
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
