import { useState, useRef, useCallback, useEffect } from 'react';

// ── continuous:true + 침묵 타이머 누적 (v4 — 최종) ──────────────
//
// ★ 반드시 읽고 수정할 것 — 이전 시도 실패 이력 ★
//
// ❌ v1 continuous:true (b958fbc):
//    accumulatedRef + interim 표시 합산 → Chrome이 isFinal을 새 interim으로
//    재전송 → "안녕하세요안녕하세요" 표시 중복
//    Chrome 강제 종료 시 accumulatedRef 미초기화 → 새 세션이 같은 텍스트 누적
//
// ❌ v2 VAD + continuous:true (3a54851):
//    별도 getUserMedia 스트림이 SpeechRecognition과 경쟁 → 재시작 더 빈번
//
// ❌ v3 continuous:false + 재시작 루프 (5b1873a → f73b9f3 → 현재):
//    onend 후 200ms 재시작 시 오디오 버퍼 재처리 →
//    세션 2가 세션 1의 발화를 다시 인식 → accumulatedRef 중복 누적 → 동결
//
// ✅ v4 원칙 (이 파일):
//    1. continuous:true → Chrome이 발화 후에도 세션 유지 (불필요한 재시작 없음)
//    2. event.resultIndex 루프 + lastProcessedIndex 가드 → isFinal 중복 방지
//    3. 표시·제출 모두 accumulatedRef || interim (절대 합산 금지)
//       → Chrome의 "isFinal→interim 재전송" 버그로 인한 중복 표시 차단
//    4. Chrome 강제 종료 시(onend):
//       - accumulatedRef 있으면 → 즉시 플러시(제출) 후 빈 상태로 재시작
//       - accumulatedRef 없으면 → 빈 상태로 300ms 후 재시작
//       → 새 세션은 항상 빈 accumulatedRef로 시작 → 버퍼 재처리해도 중복 없음
//    5. flushAccumulated: generationRef++ + stop() 후 onResult → TTS 전 SR 완전 종료

const SILENCE_TIMEOUT = 2000; // isFinal 마지막 감지 후 이 시간 침묵하면 제출

export function useVoiceInput(onResult) {
  const [isListening, setIsListening] = useState(false);
  const [liveText, setLiveText]       = useState('');

  const recognitionRef      = useRef(null);
  const activeRef           = useRef(false);
  const pausedRef           = useRef(false);
  const onResultRef         = useRef(onResult);
  const createAndStartRef   = useRef(null);
  const generationRef       = useRef(0);
  const accumulatedRef      = useRef('');   // isFinal 확정 텍스트 누적
  const latestInterimRef    = useRef('');   // 최신 interim (침묵 시 폴백 제출용)
  const submitTimerRef      = useRef(null); // 침묵 타이머

  useEffect(() => { onResultRef.current = onResult; }, [onResult]);

  // 누적 텍스트 제출 + SR 즉시 중단
  // generationRef++ → 대기 중인 모든 SR 콜백 무효화
  // recognitionRef.stop() → TTS 시작 전 SR 완전 종료 보장
  const flushAccumulated = useCallback(() => {
    clearTimeout(submitTimerRef.current);
    // accumulated 우선, 없으면 interim 폴백 (절대 합산 금지 — 중복 방지)
    const text = accumulatedRef.current.trim() || latestInterimRef.current.trim();
    accumulatedRef.current   = '';
    latestInterimRef.current = '';
    setLiveText('');
    if (text && activeRef.current && !pausedRef.current) {
      pausedRef.current = true;
      generationRef.current++;        // 진행 중인 SR 콜백 전부 무효화
      recognitionRef.current?.stop(); // SR 즉시 중단
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
    let lastProcessedIndex = -1; // 세션 내 isFinal 중복 방지
    latestInterimRef.current = '';

    const recognition = new SR();
    recognition.lang            = 'ko-KR';
    recognition.continuous      = true;   // ★ 세션 유지 → 재시작 없음 → 버퍼 재처리 없음
    recognition.interimResults  = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      if (!activeRef.current || generationRef.current !== myGen || pausedRef.current) return;

      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          // lastProcessedIndex 가드: 같은 인덱스 isFinal 중복 처리 방지
          if (i > lastProcessedIndex) {
            lastProcessedIndex = i;
            const t = event.results[i][0].transcript;
            accumulatedRef.current = accumulatedRef.current
              ? accumulatedRef.current + ' ' + t
              : t;
            latestInterimRef.current = '';
            resetSubmitTimer(); // isFinal 감지마다 침묵 타이머 리셋
          }
        } else {
          interim += event.results[i][0].transcript;
        }
      }

      latestInterimRef.current = interim;

      // ★ 표시: accumulated || interim (절대 합산 금지)
      // Chrome이 isFinal 텍스트를 새 interim으로 재전송하는 버그 대응
      setLiveText(accumulatedRef.current || interim);
    };

    recognition.onerror = (e) => {
      if (generationRef.current !== myGen) return;
      // no-speech: 발화 대기 중 → 무시 (continuous 모드에서 타이머가 관리)
      // aborted: 우리가 stop() 호출 → 무시
      if (e.error === 'no-speech' || e.error === 'aborted') return;

      // 그 외 오류 → 완전 정지
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

      // flushAccumulated 또는 pause/stop이 이미 처리한 경우
      if (pausedRef.current || !activeRef.current) return;

      // Chrome이 세션을 강제 종료한 경우
      if (accumulatedRef.current.trim()) {
        // ★ 누적 텍스트 있음 → 즉시 제출
        // 새 세션은 빈 accumulatedRef로 시작 → 버퍼 재처리해도 중복 없음
        flushAccumulated();
      } else {
        // 누적 없음 → 빈 상태로 재시작 (300ms: 오디오 버퍼 안정화)
        accumulatedRef.current   = '';
        latestInterimRef.current = '';
        setTimeout(() => {
          if (activeRef.current && !pausedRef.current && generationRef.current === myGen) {
            createAndStartRef.current?.();
          }
        }, 300);
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

  // ── 공개 API ──────────────────────────────────────────────

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