// useVoiceInput v11 — Hybrid: Web Speech API VAD + MediaRecorder → Whisper
//
// v10 → v11 fixes:
//   1. recognition.onend (desktop): was immediately flushing when text existed.
//      Chrome fires onend after ~1-2s silence even with continuous:true.
//      Fix: restart recognition on onend (same as Android). Let SILENCE_TIMEOUT
//      be the ONLY trigger for flush. This allows indefinitely long speech.
//   2. SILENCE_TIMEOUT: 2000ms → 5000ms. User must be silent for 5s to submit.
//   3. getUserMedia noiseSuppression: false → true. Prevents interfering with
//      Web Speech API's audio processing pipeline (both now use same constraints).
//
// Same external interface as v7: { isListening, liveText, toggle, start, stop, pause, resume }
// useVoiceChat.js unchanged.

import { useState, useRef, useCallback, useEffect } from 'react';

const isMobileAndroid  = /Android/i.test(navigator.userAgent);
const SILENCE_TIMEOUT  = 5000;   // ms of silence after last isFinal before sending
const RESTART_DELAY    = isMobileAndroid ? 700 : 300;
const DEDUP_WINDOW_MS  = 4000;

// ── MediaRecorder helpers ────────────────────────────────────────────────────

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

  // ── Web Speech API refs (v7) ──────────────────────────────────────────────
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

  // ── MediaRecorder refs (audio → Whisper) ─────────────────────────────────
  const streamRef         = useRef(null);
  const mimeTypeRef       = useRef('');
  const recorderRef       = useRef(null);
  const audioChunksRef    = useRef([]);
  const isCapturingRef    = useRef(false);
  const isTranscribingRef = useRef(false);

  useEffect(() => { onResultRef.current = onResult; }, [onResult]);

  // ── Audio capture (runs in parallel with Web Speech API) ─────────────────

  const startCapture = useCallback(async () => {
    if (isCapturingRef.current) return;
    try {
      // Keep stream alive across turns (only open once per conversation)
      if (!streamRef.current || streamRef.current.getTracks().some(t => t.readyState === 'ended')) {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,   // keep — prevents TTS echo
            noiseSuppression: true,   // on   — match Web Speech API defaults (prevents VAD interference)
            autoGainControl:  false,  // off  — stable signal level
          },
        });
        streamRef.current = stream;
        mimeTypeRef.current = getSupportedMimeType();
      }
      const mt = mimeTypeRef.current;
      const recorder = new MediaRecorder(streamRef.current, mt ? { mimeType: mt } : {});
      recorderRef.current   = recorder;
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data?.size > 0) audioChunksRef.current.push(e.data); };
      recorder.start(100);
      isCapturingRef.current = true;
    } catch {
      // getUserMedia failed (iOS conflict, permissions denied, etc.)
      // sendToWhisper will fall back to Web Speech API text
      streamRef.current = null;
    }
  }, []);

  const cancelCapture = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.onstop = null;
      recorder.stop();
    }
    isCapturingRef.current  = false;
    audioChunksRef.current  = [];
  }, []);

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }, []);

  // Stop recorder → collect blob → POST to /api/stt → onResult.
  // fallbackText = Web Speech API text, used if Whisper is unavailable/fails.
  const sendToWhisper = useCallback((fallbackText) => {
    if (isTranscribingRef.current) return;

    const recorder = recorderRef.current;
    const capturing = isCapturingRef.current;

    if (!recorder || recorder.state === 'inactive' || !capturing) {
      // No audio captured — use Web Speech API fallback directly
      if (fallbackText) onResultRef.current?.(fallbackText);
      return;
    }

    isTranscribingRef.current = true;
    setIsTranscribing(true);

    recorder.onstop = async () => {
      isCapturingRef.current = false;
      const chunks   = audioChunksRef.current.splice(0);
      const mimeType = mimeTypeRef.current || recorder.mimeType || 'audio/webm';
      const blob     = chunks.length ? new Blob(chunks, { type: mimeType }) : null;

      try {
        if (!blob || blob.size < 3000) throw new Error('no audio');
        const base64 = await blobToBase64(blob);
        const res = await fetch('/api/stt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ audio: base64, mimeType, contextPrompt: '' }),
        });
        if (!res.ok) throw new Error(`STT ${res.status}`);
        const { text } = await res.json();
        onResultRef.current?.((text?.trim()) || fallbackText || '');
      } catch {
        if (fallbackText) onResultRef.current?.(fallbackText);
      } finally {
        isTranscribingRef.current = false;
        setIsTranscribing(false);
      }
    };

    recorder.stop();
  }, []);

  // ── Web Speech API — v7 logic (unchanged) ────────────────────────────────

  const flushAccumulated = useCallback(() => {
    clearTimeout(submitTimerRef.current);
    const text = accumulatedRef.current.trim() || latestInterimRef.current.trim();
    accumulatedRef.current   = '';
    latestInterimRef.current = '';
    lastAddedTextRef.current = '';
    setLiveText('');
    if (text && activeRef.current && !pausedRef.current) {
      lastSubmittedTextRef.current = text;
      lastSubmittedTimeRef.current = Date.now();
      pausedRef.current = true;
      generationRef.current++;
      recognitionRef.current?.stop();
      recognitionRef.current = null;
      setIsListening(false);
      sendToWhisper(text); // ← Whisper replaces direct onResult call
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
    recognition.lang           = 'ko-KR';
    recognition.continuous     = isMobileAndroid ? false : true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      if (!activeRef.current || generationRef.current !== myGen || pausedRef.current) return;
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
              lastAddedTextRef.current = t;
              accumulatedRef.current = accumulatedRef.current
                ? accumulatedRef.current + ' ' + t : t;
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
      accumulatedRef.current = latestInterimRef.current = lastAddedTextRef.current = '';
      activeRef.current = pausedRef.current = false;
      recognitionRef.current = null;
      setIsListening(false);
      setLiveText('');
    };

    recognition.onend = () => {
      if (generationRef.current !== myGen) return;
      recognitionRef.current = null;
      if (pausedRef.current || !activeRef.current) return;
      // [v11] Desktop과 Android 모두 재시작으로 통일.
      // Chrome은 continuous:true여도 침묵 ~1-2s 후 onend를 강제 발생시킨다.
      // onend에서 즉시 flush하면 중간 발화가 끊김 → 재시작 후 SILENCE_TIMEOUT(5s)만 flush 권한을 가짐.
      // 말이 없으면 타이머가 그대로 카운트다운 → 5초 뒤 flushAccumulated 발동.
      // 말이 이어지면 새 isFinal → resetSubmitTimer → 타이머 리셋.
      setTimeout(() => {
        if (activeRef.current && !pausedRef.current && generationRef.current === myGen)
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
    startCapture(); // start audio recording in parallel
  }, [createAndStart, startCapture]);

  const pause = useCallback(() => {
    clearTimeout(submitTimerRef.current);
    accumulatedRef.current = latestInterimRef.current = lastAddedTextRef.current = '';
    pausedRef.current = true;
    recognitionRef.current?.stop();
    cancelCapture(); // discard audio — no Whisper call
  }, [cancelCapture]);

  const resume = useCallback(() => {
    clearTimeout(submitTimerRef.current);
    accumulatedRef.current = latestInterimRef.current = lastAddedTextRef.current = '';
    activeRef.current = true;
    pausedRef.current = false;
    createAndStart();
    startCapture(); // restart audio recording
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
