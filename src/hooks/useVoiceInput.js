import { useState, useRef, useCallback, useEffect } from 'react';

// ── continuous:true + 침묵 타이머 누적 (v5 — Android 모바일 이중 가드) ──────────
//
// ★ 반드시 읽고 수정할 것 — 이전 시도 실패 이력 ★
//
// ❌ v1 continuous:true (b958fbc):
//    accumulatedRef + interim 합산 → Chrome isFinal→interim 재전송 버그 → 중복 표시
//    Chrome 강제 종료 시 accumulatedRef 미초기화 → 새 세션이 같은 텍스트 누적
//
// ❌ v2 VAD + continuous:true (3a54851):
//    별도 getUserMedia 스트림이 SpeechRecognition과 경쟁 → 재시작 더 빈번
//
// ❌ v3 continuous:false + 재시작 루프 (5b1873a → f73b9f3):
//    onend 후 200ms 재시작 시 오디오 버퍼 재처리 →
//    세션 2가 세션 1의 발화를 다시 인식 → accumulatedRef 중복 누적 → 동결
//
// ❌ v4 continuous:true 단독 (eed9dff):
//    데스크탑 Chrome: 세션 유지 → 정상
//    Android Chrome: continuous:true 무시 → 매 구문 후 onend 발생 (= continuous:false)
//      → 300ms 딜레이로 오디오 버퍼 미클리어 → 새 세션이 잔여 음성 재처리 → 중복
//      → 같은 텍스트를 다른 인덱스로 두 번 isFinal 전송하는 Android Chrome 버그
//         lastProcessedIndex(인덱스 가드)로는 내용 중복 차단 불가
//
// ✅ v5 원칙 (이 파일):
//    1. continuous:true 유지 (데스크탑 정상 동작 유지)
//    2. Android 감지 → 재시작 딜레이 700ms
//       (300ms는 Android 오디오 버퍼 미클리어 → 700ms면 충분히 소멸)
//    3. lastProcessedIndex(인덱스 가드) + lastAddedText(내용 가드) 이중 중복 방지
//       Android Chrome "다른 인덱스, 동일 텍스트" isFinal 이중 전송 차단
//    4. 표시·제출 모두 accumulatedRef || interim (절대 합산 금지)
//    5. flushAccumulated: generationRef++ + stop() → TTS 전 SR 완전 종료

const isMobileAndroid = /Android/i.test(navigator.userAgent);
const SILENCE_TIMEOUT  = 2000; // isFinal 마지막 감지 후 침묵하면 제출
const RESTART_DELAY    = isMobileAndroid ? 700 : 300; // Android: 오디오 버퍼 소멸 대기

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
    let lastProcessedIndex = -1; // 세션 내 isFinal 인덱스 중복 방지
    let lastAddedText = '';      // [v5] Android Chrome 내용 중복 방지 — 다른 인덱스, 같은 텍스트 차단
    latestInterimRef.current = '';

    const recognition = new SR();
    recognition.lang            = 'ko-KR';
    recognition.continuous      = true;   // 데스크탑: 세션 유지. Android: 무시되나 해롭지 않음
    recognition.interimResults  = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      if (!activeRef.current || generationRef.current !== myGen || pausedRef.current) return;

      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          // 가드 1: 인덱스 중복 방지
          if (i > lastProcessedIndex) {
            lastProcessedIndex = i;
            const t = event.results[i][0].transcript.trim();

            // 가드 2: [v5] 내용 중복 방지
            // Android Chrome이 동일 텍스트를 다른 인덱스로 두 번 전송하는 버그 차단
            if (t && t !== lastAddedText) {
              lastAddedText = t;
              accumulatedRef.current = accumulatedRef.current
                ? accumulatedRef.current + ' ' + t
                : t;
            }

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
      // no-speech: 발화 대기 중 → 무시
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

      // Chrome이 세션을 강제 종료한 경우 (Android에서 매 구문마다 발생)
      if (accumulatedRef.current.trim()) {
        // ★ 누적 텍스트 있음 → 즉시 제출
        // 새 세션은 빈 accumulatedRef + 빈 lastAddedText로 시작 → 버퍼 재처리해도 중복 없음
        flushAccumulated();
      } else {
        // 누적 없음 → 빈 상태로 재시작
        // Android: 700ms (오디오 버퍼 소멸 보장), 데스크탑: 300ms
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
    if (activeRef.current) return;
    clearTimeout(submitTimerRef.current);
    accumulatedRef.current   = '';
    latestInterimRef.current = '';
    activeRef.current  = true;
    pausedRef.current  = false;
    createAndStart();
  }, [createAndStart]);

  // AI 응답 중 마이크 일시정지 (TTS 재생 전 호출)
  const pause = useCallback(() => {
    clearTimeout(submitTimerRef.current);
    accumulatedRef.current   = '';
    latestInterimRef.current = '';
    pausedRef.current = true;
    recognitionRef.current?.stop();
  }, []);

  // AI 응답+TTS 완료 후 마이크 재개
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
