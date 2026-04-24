import { useState, useRef, useCallback, useEffect } from 'react';

// ── continuous: false + 침묵 대기 누적 모드 ──────────────────
//
// [이전 시도 실패 이유 — 절대 되돌리지 말 것]
//
// ❌ continuous: true + SILENCE_DELAY (모바일 2200ms / 데스크탑 1400ms):
//    → Chrome이 같은 isFinal 결과를 재시작마다 재전송 → 텍스트 N배 누적
//    → VAD(Web Audio + 별도 getUserMedia) 추가했지만 경쟁 스트림이
//      SpeechRecognition 재시작을 오히려 더 빈번하게 만듦
//    → 커밋 3a54851, 5b1873a에서 실패 확인 후 폐기
//
// ✅ 현재 방식 — continuous: false + 침묵 타이머 누적:
//    - continuous: false → 1회 발화 후 Chrome이 자연 종료 (에코·중복 방지)
//    - onend에서 즉시 제출하지 않고 accumulatedRef에 텍스트 누적
//    - SILENCE_TIMEOUT(2000ms) 동안 추가 발화 없으면 제출
//    - 추가 발화 감지 시 타이머 리셋 → 계속 누적
//    - flushAccumulated에서 SR 즉시 중단 + generationRef 무효화 후 제출
//      → TTS 시작 전 SR이 완전히 종료된 상태를 보장 (에코 근본 차단)
//
// [SILENCE_TIMEOUT 조정 이력]
//   1500ms → 2000ms: 자연스러운 한국어 발화 텀 허용
//   (continuous:true였던 과거와 달리 continuous:false에서는 타임아웃 증가가
//    에코·중복을 유발하지 않음 — SR 세션이 단일 발화 단위로 독립 관리됨)

const SILENCE_TIMEOUT = 2000; // 발화 후 이 시간(ms) 동안 침묵하면 제출

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
  // ★ SR을 즉시 중단 + generationRef 무효화 후 onResult 호출
  //   → flushAccumulated → onResult → sendMessage → pauseMic 사이에
  //     어떤 SR 세션도 실행되지 않음 (TTS 에코 근본 차단)
  const flushAccumulated = useCallback(() => {
    clearTimeout(submitTimerRef.current);
    const text = accumulatedRef.current.trim();
    accumulatedRef.current = '';
    setLiveText('');
    if (text && activeRef.current && !pausedRef.current) {
      pausedRef.current = true;
      // 진행 중인 SR 세션 즉시 종료 + 대기 중인 재시작 콜백 무효화
      generationRef.current++;
      recognitionRef.current?.stop();
      recognitionRef.current = null;
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
    recognition.continuous      = false;  // 1회 발화 후 자동 종료 (에코·중복 방지)
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
        setLiveText((accumulatedRef.current ? accumulatedRef.current + ' ' : '') + final);
      } else {
        setLiveText((accumulatedRef.current ? accumulatedRef.current + ' ' : '') + interim);
      }
    };

    recognition.onerror = (e) => {
      if (generationRef.current !== myGen) return;

      if (e.error === 'no-speech') {
        // 발화 없음 → 누적 텍스트가 있으면 타이머가 제출
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

        // 계속 듣기 — 추가 발화 대기 (200ms: 이전 세션 완전 종료 후 재시작)
        if (activeRef.current && !pausedRef.current) {
          setTimeout(() => {
            if (activeRef.current && !pausedRef.current) {
              createAndStartRef.current?.();
            }
          }, 200);
        }
        return;
      }

      // 이번 세션에 발화 없음 (no-speech 또는 자연 종료)
      if (activeRef.current && !pausedRef.current && !retryScheduledRef.current) {
        setTimeout(() => {
          if (activeRef.current && !pausedRef.current && generationRef.current === myGen) {
            createAndStartRef.current?.();
          }
        }, 150);
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
    setIsL