// useVoiceInput v12 — Keep-alive recognition (no stop/restart outside gesture)
//
// v11 → v12 key change:
//   Chrome blocks recognition.start() outside user-gesture context.
//   Fix: Never call recognition.stop() in pause(). Recognition stays alive.
//   onend (Chrome forced) → always restart if active, even when paused.
//   resume() → only calls createAndStart() if recognition is null.
//   flushAccumulated → just sets pausedRef=true, does NOT stop recognition.
//   Result: recognition.start() is only ever called ONCE (within gesture),
//   and on Chrome-forced onend restarts (which Chrome permits as continuation).

import { useState, useRef, useCallback, useEffect } from 'react';

const isMobileAndroid  = /Android/i.test(navigator.userAgent);
const isMobileDevice   = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
// Mobile(Android): continuous=false라서 발화 끝나면 인식 즉시 종료 → 5초 대기는 과도함
const SILENCE_TIMEOUT  = isMobileDevice ? 2500 : 5000;
const RESTART_DELAY    = isMobileAndroid ? 700 : 300;
const DEDUP_WINDOW_MS  = 4000;
// TTS 종료 후 resumeMic() 직후 잔향 에코 방지용 짧은 유예 기간
// 2000ms는 과도해 사용자 발화를 차단함 → 200ms로 최소화
const RESUME_GRACE_MS  = 200;

// ── MediaRecorder helpers ─────────────────────────────────────────────────────

function getSupportedMimeType() {
  const candidates = [
    'audio/webm;codecs=opus', 'audio/webm',
    'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg',
  ];
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return '';
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useVoiceInput(onResult) {
  const [isListening,    setIsListening]    = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [liveText,       setLiveText]       = useState('');

  const recognitionRef       = useRef(null);
  const activeRef            = useRef(false);
  const pausedRef            = useRef(false);
  const onResultRef          = useRef(onResult);
  const createAndStartRef    = useRef(null);
  const generationRef        = useRef(0);
  const accumulatedRef       = useRef('');
  const latestInterimRef     = useRef('');
  const submitTimerRef       = useRef(null);
  const lastAddedTextRef     = useRef('');
  const lastSubmittedTextRef = useRef('');
  const lastSubmittedTimeRef = useRef(0);

  const streamRef         = useRef(null);
  const mimeTypeRef       = useRef('');
  const recorderRef       = useRef(null);
  const audioChunksRef    = useRef([]);
  const isCapturingRef    = useRef(false);
  const isTranscribingRef = useRef(false);
  const lastResumeTimeRef = useRef(0); // resumeMic() 호출 시각 — grace period 계산에 사용

  useEffect(() => { onResultRef.current = onResult; }, [onResult]);

  // ── Audio capture ─────────────────────────────────────────────────────────

  const startCapture = useCallback(async () => {
    // Android: getUserMedia stream interferes with SpeechRecognition's internal
    // audio capture, causing recognition to cycle without detecting any speech.
    // On mobile, skip MediaRecorder entirely and rely on Web Speech API text.
    if (isMobileDevice) return;
    if (isCapturingRef.current) return;
    try {
      if (!streamRef.current || streamRef.current.getTracks().some(t => t.readyState === 'ended')) {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl:  false,
          },
        });
        streamRef.current = stream;
        mimeTypeRef.current = getSupportedMimeType();
      }
      const mt = mimeTypeRef.current;
      const recorder = new MediaRecorder(streamRef.current, mt ? { mimeType: mt } : {});
      recorderRef.current    = recorder;
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data?.size > 0) audioChunksRef.current.push(e.data); };
      recorder.start(100);
      isCapturingRef.current = true;
    } catch {
      streamRef.current = null;
    }
  }, []);

  const cancelCapture = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.onstop = null;
      recorder.stop();
    }
    isCapturingRef.current = false;
    audioChunksRef.current = [];
  }, []);

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }, []);

  const sendToWhisper = useCallback((fallbackText) => {
    if (isTranscribingRef.current) return;

    const recorder  = recorderRef.current;
    const capturing = isCapturingRef.current;

    // recorder가 inactive이거나 캡처 중이 아니면 Web Speech fallback 사용
    if (!recorder || recorder.state === 'inactive' || !capturing) {
      if (recorder && recorder.state !== 'inactive') {
        recorder.onstop = null;
        recorder.stop();
      }
      isCapturingRef.current = false;
      audioChunksRef.current = [];
      if (fallbackText) onResultRef.current?.(fallbackText);
      return;
    }

    isTranscribingRef.current = true;
    setIsTranscribing(true);
    isCapturingRef.current = false; // 중복 캡처 방지

    // recorder.stop() → ondataavailable(마지막 청크) → onstop 순서로 실행됨
    recorder.onstop = async () => {
      const chunks   = audioChunksRef.current.splice(0);
      const mimeType = mimeTypeRef.current || recorder.mimeType || 'audio/webm';
      const blob     = chunks.length ? new Blob(chunks, { type: mimeType }) : null;
      const MIN_BLOB = isMobileDevice ? 1000 : 3000;
      try {
        if (!blob || blob.size < MIN_BLOB) throw new Error('no audio');
        const base64 = await blobToBase64(blob);
        const res = await fetch('/api/stt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ audio: base64, mimeType, contextPrompt: '' }),
        });
        if (!res.ok) throw new Error(`STT ${res.status}`);
        const { text } = await res.json();
        setLiveText('');
        onResultRef.current?.(text?.trim() || fallbackText || '');
      } catch {
        setLiveText('');
        // Whisper 실패 시 Web Speech API 텍스트를 fallback으로 사용
        if (fallbackText) onResultRef.current?.(fallbackText);
      } finally {
        isTranscribingRef.current = false;
        setIsTranscribing(false);
      }
    };
    recorder.stop(); // ondataavailable + onstop 순으로 발화
  }, []);

  // ── Web Speech API ────────────────────────────────────────────────────────

  const flushAccumulated = useCallback(() => {
    clearTimeout(submitTimerRef.current);
    const text = accumulatedRef.current.trim() || latestInterimRef.current.trim();
    accumulatedRef.current   = '';
    latestInterimRef.current = '';
    lastAddedTextRef.current = '';
    if (text) setLiveText(text); else setLiveText('');

    if (text && activeRef.current && !pausedRef.current) {
      lastSubmittedTextRef.current = text;
      lastSubmittedTimeRef.current = Date.now();
      pausedRef.current = true;
      sendToWhisper(text); // recorder가 살아있으면 Whisper 전송, inactive면 Web Speech 텍스트 fallback
    }
  }, [sendToWhisper]);

  const resetSubmitTimer = useCallback(() => {
    clearTimeout(submitTimerRef.current);
    submitTimerRef.current = setTimeout(flushAccumulated, SILENCE_TIMEOUT);
  }, [flushAccumulated]);

  const createAndStart = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;

    const myGen = ++generationRef.current;
    let lastProcessedIndex = -1;
    latestInterimRef.current = '';

    const recognition = new SR();
    recognition.lang            = 'ko-KR';
    recognition.continuous      = true;
    recognition.interimResults  = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      if (!activeRef.current || generationRef.current !== myGen || pausedRef.current) return;
      // TTS 종료 후 grace period 동안 결과 무시 — 에코(TTS 잔향) 방지
      if (RESUME_GRACE_MS > 0 && Date.now() - lastResumeTimeRef.current < RESUME_GRACE_MS) {
        accumulatedRef.current = latestInterimRef.current = lastAddedTextRef.current = '';
        setLiveText('');
        return;
      }
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          if (i > lastProcessedIndex) {
            lastProcessedIndex = i;
            const t = event.results[i][0].transcript.trim();
            const isDup = isMobileAndroid && t === lastSubmittedTextRef.current &&
              (Date.now() - lastSubmittedTimeRef.current) < DEDUP_WINDOW_MS;
            if (isDup) { resetSubmitTimer(); continue; }
            if (t && t !== lastAddedTextRef.current) {
              // Chrome Android continuous=true fires rolling transcripts: each new final
              // result often starts with the previous result's text as a prefix.
              // Detect this overlap and replace rather than append to avoid duplicates.
              if (lastAddedTextRef.current && t.startsWith(lastAddedTextRef.current + ' ')) {
                const prefix = accumulatedRef.current
                  .slice(0, accumulatedRef.current.lastIndexOf(lastAddedTextRef.current))
                  .trimEnd();
                accumulatedRef.current = prefix ? prefix + ' ' + t : t;
              } else {
                accumulatedRef.current = accumulatedRef.current
                  ? accumulatedRef.current + ' ' + t : t;
              }
              lastAddedTextRef.current = t;
            }
            latestInterimRef.current = '';
            resetSubmitTimer();
          }
        } else {
          interim += event.results[i][0].transcript;
        }
      }
      if (interim) resetSubmitTimer();
      latestInterimRef.current = interim;
      setLiveText(accumulatedRef.current || interim);
    };

    recognition.onerror = (e) => {
      if (generationRef.current !== myGen) return;
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      clearTimeout(submitTimerRef.current);
      accumulatedRef.current = latestInterimRef.current = lastAddedTextRef.current = '';
      activeRef.current = pausedRef.current = false;
      recognitionRef.current = null;
      setIsListening(false);
      setLiveText('');
    };

    recognition.onend = () => {
      if (generationRef.current !== myGen) return;
      recognitionRef.current = null;
      if (!activeRef.current) return;
      if (pausedRef.current) return;
      setTimeout(() => {
        if (activeRef.current && generationRef.current === myGen)
          createAndStartRef.current?.();
      }, RESTART_DELAY);
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

  // ── Public interface ──────────────────────────────────────────────────────

  const stop = useCallback(() => {
    clearTimeout(submitTimerRef.current);
    generationRef.current++;
    activeRef.current = pausedRef.current = false;
    accumulatedRef.current = latestInterimRef.current = lastAddedTextRef.current = '';
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setIsListening(false);
    setLiveText('');
    cancelCapture();
    releaseStream();
  }, [cancelCapture, releaseStream]);

  const start = useCallback(() => {
    if (activeRef.current) return;
    clearTimeout(submitTimerRef.current);
    accumulatedRef.current = latestInterimRef.current = lastAddedTextRef.current = '';
    activeRef.current = true;
    pausedRef.current = false;
    createAndStart();
    startCapture();
  }, [createAndStart, startCapture]);

  // pause: block result processing only — do NOT abort recognition.
  // Keeping recognition alive during TTS means Android OS mic icon stays visible
  // and no recognition.start() restart beep is needed after TTS.
  // If Android AudioFocus kills recognition anyway, onend returns early (pausedRef=true)
  // and resumeMic() restarts it once — one beep at most per AI turn.
  const pause = useCallback(() => {
    clearTimeout(submitTimerRef.current);
    accumulatedRef.current = latestInterimRef.current = lastAddedTextRef.current = '';
    pausedRef.current = true;
    cancelCapture();
    setLiveText('');
  }, [cancelCapture]);

  // [v13] resume: always create fresh recognition (aborted in pause).
  // Fresh start clears any internal audio buffer → no TTS echo.
  const resume = useCallback(() => {
    clearTimeout(submitTimerRef.current);
    accumulatedRef.current = latestInterimRef.current = lastAddedTextRef.current = '';
    lastResumeTimeRef.current = Date.now();
    activeRef.current = true;
    pausedRef.current = false;
    if (!recognitionRef.current) {
      createAndStart();
    }
    startCapture();
  }, [createAndStart, startCapture]);

  const toggle = useCallback(() => {
    if (activeRef.current) stop();
    else start();
  }, [stop, start]);

  return {
    isListening: isListening || isTranscribing,
    liveText,
    toggle, start, stop, pause, resume,
  };
}
