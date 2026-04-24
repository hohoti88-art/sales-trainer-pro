import { useState, useRef, useCallback, useEffect } from 'react';

// ── useVoiceInput v7 — Android: continuous:false + hook-scope lastAddedTextRef ──
//
// ★ 이전 시도 실패 이력 요약 ★
//
// ❌ v4~v6 공통 실패 원인:
//    Android Chrome은 continuous:true여도 매 구문 후 onend 발생 (= continuous:false 동작)
//    + continuous:true 상태에서 "안녕" isFinal 후 "안녕하세요" isFinal 재전송 (부분→전체 확정 버그)
//      두 텍스트가 다르므로 lastAddedText(=이전값) 가드가 차단 못함 → 중복 누적
//    + lastAddedText가 createAndStart() 로컬 변수 → 세션 재시작 시 리셋
//      → 새 세션이 이전 세션의 잔여 오디오를 다시 인식해도 차단 불가
//
// ✅ v7 원칙:
//    1. Android: continuous:false
//       → Chrome이 완전한 발화 1개를 인식 후 isFinal 1회만 전송 (부분 확정 없음)
//       → 세션 1개당 isFinal 1회 → 중복 누적 원천 차단
//    2. lastAddedTextRef: 훅 스코프 (세션 재시작 시 리셋 안 됨)
//       → 새 세션이 이전 발화 잔여 오디오 재인식해도 차단
//       → stop/resume/flushAccumulated 시에만 초기화 (대화 턴 전환 시)
//    3. Android onend with accumulated: flush하지 않고 재시작
//       → 침묵 타이머가 2s 후 자연스럽게 flush (연속 발화 지원)
//    4. Desktop: continuous:true 유지 (기존 동작 유지)
//    5. lastSubmittedTextRef: 제출 후 4s 이내 동일 텍스트 재제출 차단 (추가 안전망)

const isMobileAndroid  = /Android/i.test(navigator.userAgent);
const SILENCE_TIMEOUT  = 2000;
const RESTART_DELAY    = isMobileAndroid ? 700 : 300;
const DEDUP_WINDOW_MS  = 4000;

export function useVoiceInput(onResult) {
  const [isListening, setIsListening] = useState(false);
  const [liveText, setLiveText]       = useState('');

  const recognitionRef         = useRef(null);
  const activeRef              = useRef(false);
  const pausedRef              = useRef(false);
  const onResultRef            = useRef(onResult);
  const createAndStartRef      = useRef(null);
  const generationRef          = useRef(0);
  const accumulatedRef         = useRef('');
  const latestInterimRef       = useRef('');
  const submitTimerRef         = useRef(null);
  // [v7] 훅 스코프 — 세션 재시작해도 유지, 대화 턴 전환 시에만 초기화
  const lastAddedTextRef       = useRef('');  // 누적 중복 방지
  const lastSubmittedTextRef   = useRef('');  // 제출 중복 방지
  const lastSubmittedTimeRef   = useRef(0);

  useEffect(() => { onResultRef.current = onResult; }, [onResult]);

  const flushAccumulated = useCallback(() => {
    clearTimeout(submitTimerRef.current);
    const text = accumulatedRef.current.trim() || latestInterimRef.current.trim();
    accumulatedRef.current   = '';
    latestInterimRef.current = '';
    lastAddedTextRef.current = ''; // 대화 턴 전환 → 초기화
    setLiveText('');
    if (text && activeRef.current && !pausedRef.current) {
      lastSubmittedTextRef.current = text;
      lastSubmittedTimeRef.current = Date.now();
      pausedRef.current = true;
      generationRef.current++;
      recognitionRef.current?.stop();
      recognitionRef.current = null;
      setIsListening(false);
      onResultRef.current(text);
    }
  }, []);

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
    let lastProcessedIndex = -1;
    latestInterimRef.current = '';

    const recognition = new SR();
    recognition.lang            = 'ko-KR';
    // [v7] Android: false → Chrome이 완전한 발화 1개만 인식 (부분 isFinal 없음)
    //      Desktop: true  → 세션 유지로 재시작 최소화
    recognition.continuous      = isMobileAndroid ? false : true;
    recognition.interimResults  = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      if (!activeRef.current || generationRef.current !== myGen || pausedRef.current) return;

      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          if (i > lastProcessedIndex) {
            lastProcessedIndex = i;
            const t = event.results[i][0].transcript.trim();

            // 제출 중복 가드: 최근 제출 텍스트와 동일하면 차단
            const isSubmitDup =
              isMobileAndroid &&
              t === lastSubmittedTextRef.current &&
              (Date.now() - lastSubmittedTimeRef.current) < DEDUP_WINDOW_MS;
            if (isSubmitDup) { resetSubmitTimer(); continue; }

            // 누적 중복 가드: 직전 추가 텍스트와 동일하면 차단 (훅 스코프 — 세션 간 유지)
            if (t && t !== lastAddedTextRef.current) {
              lastAddedTextRef.current = t;
              accumulatedRef.current = accumulatedRef.current
                ? accumulatedRef.current + ' ' + t
                : t;
            }

            latestInterimRef.current = '';
            resetSubmitTimer();
          }
        } else {
          interim += event.results[i][0].transcript;
        }
      }

      latestInterimRef.current = interim;
      setLiveText(accumulatedRef.current || interim);
    };

    recognition.onerror = (e) => {
      if (generationRef.current !== myGen) return;
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      clearTimeout(submitTimerRef.current);
      accumulatedRef.current   = '';
      latestInterimRef.current = '';
      lastAddedTextRef.current = '';
      activeRef.current  = false;
      pausedRef.current  = false;
      recognitionRef.current = null;
      setIsListening(false);
      setLiveText('');
    };

    recognition.onend = () => {
      if (generationRef.current !== myGen) return;
      recognitionRef.current = null;
      if (pausedRef.current || !activeRef.current) return;

      if (accumulatedRef.current.trim()) {
        if (isMobileAndroid) {
          // [v7] Android continuous:false 정상 종료
          // isFinal 후 세션이 끝나는 게 정상 — flush하지 않고 재시작
          // 침묵 타이머가 2s 후 자연스럽게 flush (연속 발화 지원)
          setTimeout(() => {
            if (activeRef.current && !pausedRef.current && generationRef.current === myGen) {
              createAndStartRef.current?.();
            }
          }, RESTART_DELAY);
        } else {
          // Desktop: continuous:true인데 onend → Chrome 강제 종료 → 즉시 flush
          flushAccumulated();
        }
      } else {
        // 누적 없음 → 재시작 대기
        accumulatedRef.current   = '';
        latestInterimRef.current = '';
        setTimeout(() => {
          if (activeRef.current && !pausedRef.current && generationRef.current === myGen) {
            createAndStartRef.current?.();
          }
        }, RESTART_DELAY);
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
  }, [resetSubmitTimer, flushAccumulated]);

  createAndStartRef.current = createAndStart;

  const stop = useCallback(() => {
    clearTimeout(submitTimerRef.current);
    generationRef.current++;
    activeRef.current        = false;
    pausedRef.current        = false;
    accumulatedRef.current   = '';
    latestInterimRef.current = '';
    lastAddedTextRef.current = '';
    recognitionRef.current?.stop();
    recognitionRef.current   = null;
    setIsListening(false);
    setLiveText('');
  }, []);

  const start = useCallback(() => {
    if (activeRef.current) return;
    clearTimeout(submitTimerRef.current);
    accumulatedRef.current   = '';
    latestInterimRef.current = '';
    lastAddedTextRef.current = '';
    activeRef.current  = true;
    pausedRef.current  = false;
    createAndStart();
  }, [createAndStart]);

  const pause = useCallback(() => {
    clearTimeout(submitTimerRef.current);
    accumulatedRef.current   = '';
    latestInterimRef.current = '';
    lastAddedTextRef.current = '';
    pausedRef.current = true;
    recognitionRef.current?.stop();
  }, []);

  const resume = useCallback(() => {
    clearTimeout(submitTimerRef.current);
    accumulatedRef.current   = '';
    latestInterimRef.current = '';
    lastAddedTextRef.current = '';
    activeRef.current  = true;
    pausedRef.current  = false;
    createAndStart();
  }, [createAndStart]);

  const toggle = useCallback(() => {
    if (activeRef.current) stop();
    else start();
  }, [stop, start]);

  return { isListening, liveText, toggle, start, stop, pause, resume };
}
