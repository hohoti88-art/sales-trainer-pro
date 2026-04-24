import { useState, useRef, useCallback, useEffect } from 'react';

const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

// SpeechRecognition 타이머 — VAD가 실패했을 때 폴백
const SILENCE_DELAY = isMobile ? 2200 : 1400;

// Web Audio VAD 상수
const VAD_THRESHOLD = 15;                        // 0-255 중 이 에너지 이상 = 발화
const VAD_SILENCE_MS = isMobile ? 1300 : 850;   // 타이머보다 짧아도 되는 이유: VAD가 더 정확함

export function useVoiceInput(onResult) {
  const [isListening, setIsListening] = useState(false);
  const [liveText, setLiveText] = useState('');

  const recognitionRef   = useRef(null);
  const silenceTimerRef  = useRef(null);
  const accumulatedRef   = useRef('');
  const currentInterimRef = useRef(''); // VAD가 submit 시 최신 interim 참조용
  const activeRef        = useRef(false);
  const pausedRef        = useRef(false);
  const onResultRef      = useRef(onResult);
  const createAndStartRef = useRef(null);
  const generationRef    = useRef(0);
  const vadCleanupRef    = useRef(null); // 현재 VAD 인스턴스의 cleanup 함수

  useEffect(() => { onResultRef.current = onResult; }, [onResult]);

  // ── Web Audio VAD ──────────────────────────────────────────
  // SpeechRecognition 타이머보다 정확하게 발화 종료를 감지.
  // 별도의 getUserMedia 스트림(echoCancellation:true)을 열어 AnalyserNode로 에너지 측정.
  // 발화 후 VAD_SILENCE_MS 동안 에너지가 VAD_THRESHOLD 미만이면 submit 트리거.
  const startVAD = useCallback((myGen, onVadSilence) => {
    if (!navigator.mediaDevices?.getUserMedia) return null;

    let active = true;
    let speakingDetected = false;
    let silenceStart = null;
    let frameId = null;
    let stream = null;
    let audioCtx = null;

    navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    }).then(s => {
      if (!active) { s.getTracks().forEach(t => t.stop()); return; }
      stream = s;
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const src = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.5;
      src.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        if (!active) return;
        analyser.getByteFrequencyData(data);
        // 음성 주파수 대역 bins 1-32 (~100-2700Hz) 평균 에너지
        let energy = 0;
        for (let i = 1; i <= 32; i++) energy += data[i];
        energy /= 32;

        if (energy >= VAD_THRESHOLD) {
          speakingDetected = true;
          silenceStart = null;
        } else if (speakingDetected) {
          if (!silenceStart) {
            silenceStart = Date.now();
          } else if (Date.now() - silenceStart >= VAD_SILENCE_MS) {
            // 발화 후 침묵 감지 — generation 가드 통과 시 submit
            if (generationRef.current === myGen && activeRef.current && !pausedRef.current) {
              active = false;
              cleanup();
              onVadSilence();
            }
            return;
          }
        }
        frameId = requestAnimationFrame(tick);
      };
      frameId = requestAnimationFrame(tick);
    }).catch(() => {
      // getUserMedia 실패 시 무음 처리 — SpeechRecognition 타이머가 폴백으로 동작
    });

    const cleanup = () => {
      active = false;
      if (frameId) { cancelAnimationFrame(frameId); frameId = null; }
      try { audioCtx?.close(); } catch {}
      audioCtx = null;
      stream?.getTracks().forEach(t => t.stop());
      stream = null;
    };

    return cleanup;
  }, []);

  // ── SpeechRecognition 인스턴스 생성 및 시작 ───────────────
  const createAndStart = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      alert('음성 인식이 지원되지 않습니다. Chrome 또는 Safari를 사용해주세요.');
      return;
    }

    const myGen = ++generationRef.current;
    let lastFinalIndex = -1;

    // submit 로직을 명시적 함수로 분리 — 타이머와 VAD 모두 이 함수를 호출
    const submitText = (interim = '') => {
      if (generationRef.current !== myGen) return;
      if (pausedRef.current) return;
      // accumulated(확정) 우선, 없으면 interim — 절대 두 개를 합치지 않음
      // (Chrome 모바일이 isFinal 구간을 새 interim으로 재전송 → 합치면 중복)
      const full = accumulatedRef.current.trim() || interim.trim();
      accumulatedRef.current = '';
      currentInterimRef.current = '';
      setLiveText('');
      if (full) {
        pausedRef.current = true;
        recognition.stop();
        onResultRef.current(full);
      } else {
        recognition.stop();
      }
    };

    const recognition = new SR();
    recognition.lang = 'ko-KR';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      if (!activeRef.current || generationRef.current !== myGen || pausedRef.current) return;
      clearTimeout(silenceTimerRef.current);

      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) {
          if (i > lastFinalIndex) {
            accumulatedRef.current += r[0].transcript;
            lastFinalIndex = i;
          }
        } else {
          interim += r[0].transcript;
        }
      }
      currentInterimRef.current = interim;
      setLiveText(accumulatedRef.current + interim);

      // VAD가 작동 중이더라도 타이머를 폴백으로 유지
      silenceTimerRef.current = setTimeout(
        () => submitText(currentInterimRef.current),
        SILENCE_DELAY
      );
    };

    recognition.onerror = (e) => {
      if (e.error === 'no-speech') return;
      if (generationRef.current !== myGen) return;
      clearTimeout(silenceTimerRef.current);
      vadCleanupRef.current?.();
      vadCleanupRef.current = null;
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

      // VAD 시작 — 이전 인스턴스 정리 후 새로 시작
      vadCleanupRef.current?.();
      vadCleanupRef.current = startVAD(myGen, () => {
        clearTimeout(silenceTimerRef.current);
        submitText(currentInterimRef.current);
      });
    } catch {
      activeRef.current = false;
      setIsListening(false);
    }
  }, [startVAD]);

  createAndStartRef.current = createAndStart;

  const stop = useCallback(() => {
    clearTimeout(silenceTimerRef.current);
    generationRef.current++;
    activeRef.current = false;
    pausedRef.current = false;
    vadCleanupRef.current?.();
    vadCleanupRef.current = null;
    recognitionRef.current?.stop();
    setIsListening(false);
    setLiveText('');
    accumulatedRef.current = '';
    currentInterimRef.current = '';
  }, []);

  const start = useCallback(() => {
    if (activeRef.current) return;
    accumulatedRef.current = '';
    currentInterimRef.current = '';
    activeRef.current = true;
    pausedRef.current = false;
    createAndStart();
  }, [createAndStart]);

  const pause = useCallback(() => {
    pausedRef.current = true;
    clearTimeout(silenceTimerRef.current);
    vadCleanupRef.current?.();
    vadCleanupRef.current = null;
    recognitionRef.current?.stop();
  }, []);

  const resume = useCallback(() => {
    activeRef.current = true;
    pausedRef.current = false;
    accumulatedRef.current = '';
    currentInterimRef.current = '';
    createAndStart();
  }, [createAndStart]);

  const toggle = useCallback(() => {
    if (activeRef.current) stop();
    else start();
  }, [stop, start]);

  return { isListening, liveText, toggle, start, stop, pause, resume };
}
