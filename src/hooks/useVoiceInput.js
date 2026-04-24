import { useState, useRef, useCallback, useEffect } from 'react';

// ── continuous:true + 침묵 타이머 누적 (v6) ──────────────────────────────────
//
// ★ 반드시 읽고 수정할 것 — 이전 시도 실패 이력 ★
//
// ❌ v1~v3: 중복/에코/버퍼 재처리 문제 (git 히스토리 참조)
//
// ❌ v4 (eed9dff): continuous:true 단독
//    Android Chrome은 continuous:true를 무시 — 매 구문 후 onend 발생
//    → 재시작 여전히 발생, 300ms 딜레이로 Android 오디오 버퍼 미클리어
//
// ❌ v5 (6aa0c89): Android 재시작 딜레이 700ms + lastAddedText 가드
//    lastAddedText가 createAndStart() 내부 로컬 변수 → 세션 재시작 시 리셋
//    → 세션 간 중복(이전 세션에서 제출한 텍스트가 새 세션에서 재인식)은 무방비
//    + 서비스워커가 html 캐싱 → 배포해도 구버전 JS 계속 제공 (vite.config.js 수정 병행)
//
// ✅ v6 원칙 (이 파일):
//    1. continuous:true 유지 (데스크탑 세션 유지)
//    2. Android 재시작 딜레이 700ms
//    3. lastSubmittedTextRef — 훅 스코프(세션 간 유지) 중복 가드
//       flushAccumulated 시 제출 텍스트 저장 → 4초 이내 동일 텍스트 isFinal 무시
//       → Android Chrome 오디오 버퍼 잔류 재인식 차단
//    4. lastProcessedIndex(인덱스 가드) + lastAddedText(세션 내 내용 가드) 유지
//    5. 표시: accumulatedRef || interim (절대 합산 금지)
//    6. vite.config.js: html 서비스워커 캐시 제외 → 배포 즉시 최신 JS 적용

const isMobileAndroid  = /Android/i.test(navigator.userAgent);
const SILENCE_TIMEOUT  = 2000;
const RESTART_DELAY    = isMobileAndroid ? 700 : 300;
const DEDUP_WINDOW_MS  = 4000; // 제출 후 이 시간 내 동일 텍스트 isFinal 무시

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
  // [v6] 세션 간 중복 방지 — 훅 스코프에서 유지됨 (세션 재시작해도 리셋 안 됨)
  const lastSubmittedTextRef   = useRef('');
  const lastSubmittedTimeRef   = useRef(0);

  useEffect(() => { onResultRef.current = onResult; }, [onResult]);

  const flushAccumulated = useCallback(() => {
    clearTimeout(submitTimerRef.current);
    const text = accumulatedRef.current.trim() || latestInterimRef.current.trim();
    accumulatedRef.current   = '';
    latestInterimRef.current = '';
    setLiveText('');
    if (text && activeRef.current && !pausedRef.current) {
      // [v6] 제출 텍스트 기록 — 새 세션에서 동일 텍스트 재인식 차단용
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
    let lastProcessedIndex = -1; // 세션 내 인덱스 중복 가드
    let lastAddedText = '';      // 세션 내 내용 중복 가드
    latestInterimRef.current = '';

    const recognition = new SR();
    recognition.lang            = 'ko-KR';
    recognition.continuous      = true;
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

            // [v6] 세션 간 중복 가드
            // Android Chrome: 이전 세션에서 제출한 텍스트가 새 세션에서 재인식될 때 차단
            const isRecentDuplicate =
              isMobileAndroid &&
              t === lastSubmittedTextRef.current &&
              (Date.now() - lastSubmittedTimeRef.current) < DEDUP_WINDOW_MS;

            if (isRecentDuplicate) {
              // 중복 감지 — 타이머만 리셋하고 accumulate는 건너뜀
              resetSubmitTimer();
              continue;
            }

            // 세션 내 내용 중복 가드 (Android Chrome 동일 인덱스+다른 인덱스 이중 전송 방어)
            if (t && t !== lastAddedText) {
              lastAddedText = t;
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
        flushAccumulated();
      } else {
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
    activeRef.current  = true;
    pausedRef.current  = false;
    createAndStart();
  }, [createAndStart]);

  const pause = useCallback(() => {
    clearTimeout(submitTimerRef.current);
    accumulatedRef.current   = '';
    latestInterimRef.current = '';
    pausedRef.current = true;
    recognitionRef.current?.stop();
  }, []);

  const resume = useCallback(() => {
    clearTimeout(submitTimerRef.current);
    accumulatedRef.current   = '';
    latestInterimRef.current = '';
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
