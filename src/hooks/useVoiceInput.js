// useVoiceInput v13 — Dual-mode STT
//
// Mobile (Android/iOS):
//   AudioContext AnalyserNode → VAD (volume threshold)
//   → MediaRecorder (audio capture)
//   → /api/stt Whisper (GPT-mini transcribe)
//   SpeechRecognition을 사용하지 않으므로 Chrome 활성음(벨소리) 없음.
//
// PC:
//   SpeechRecognition (continuous) → interim/final text
//   + MediaRecorder → /api/stt Whisper (최종 정확도 향상)
//   기존 v12 경로 그대로 유지.

import { useState, useRef, useCallback, useEffect } from 'react';

const isMobileDevice = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

// ── PC constants ──────────────────────────────────────────────────────────────
const SILENCE_TIMEOUT  = 5000;
const RESTART_DELAY    = 300;
const DEDUP_WINDOW_MS  = 4000;
const RESUME_GRACE_MS  = 200;

// ── Mobile VAD constants ──────────────────────────────────────────────────────
const VAD_SPEECH_THRESHOLD  = 20;   // RMS 0-100: 이 값 이상이면 발화로 판단
const VAD_SILENCE_THRESHOLD = 12;   // RMS 0-100: 이 값 이하면 침묵으로 판단
const VAD_SILENCE_TIMEOUT   = 2200; // ms 침묵 유지 후 Whisper 전송
const VAD_MIN_SPEECH_MS     = 500;  // 최소 발화 길이 (짧은 노이즈 무시)

// ── helpers ───────────────────────────────────────────────────────────────────

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

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useVoiceInput(onResult) {
  const [isListening,    setIsListening]    = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [liveText,       setLiveText]       = useState('');

  const activeRef      = useRef(false);
  const pausedRef      = useRef(false);
  const onResultRef    = useRef(onResult);
  useEffect(() => { onResultRef.current = onResult; }, [onResult]);

  // ── Shared audio refs ─────────────────────────────────────────────────────
  const streamRef         = useRef(null);
  const mimeTypeRef       = useRef('');
  const recorderRef       = useRef(null);
  const audioChunksRef    = useRef([]);
  const isCapturingRef    = useRef(false);
  const isTranscribingRef = useRef(false);
  const lastResumeTimeRef = useRef(0);

  // ── Mobile VAD refs ───────────────────────────────────────────────────────
  const vadContextRef   = useRef(null);
  const vadAnalyserRef  = useRef(null);
  const vadFrameRef     = useRef(null);
  const isSpeakingVAD   = useRef(false);
  const silenceVADTimer = useRef(null);
  const speechStartTime = useRef(0);

  // ── PC SpeechRecognition refs ─────────────────────────────────────────────
  const recognitionRef       = useRef(null);
  const createAndStartRef    = useRef(null);
  const generationRef        = useRef(0);
  const accumulatedRef       = useRef('');
  const latestInterimRef     = useRef('');
  const submitTimerRef       = useRef(null);
  const lastAddedTextRef     = useRef('');
  const lastSubmittedTextRef = useRef('');
  const lastSubmittedTimeRef = useRef(0);

  // ══════════════════════════════════════════════════════════════════════════
  // MOBILE PATH: AudioContext VAD → MediaRecorder → Whisper
  // ══════════════════════════════════════════════════════════════════════════

  const initMobileAudio = useCallback(async () => {
    const streamOk = streamRef.current?.active &&
      !streamRef.current.getTracks().some(t => t.readyState === 'ended');
    const ctxOk = vadContextRef.current && vadContextRef.current.state !== 'closed';
    if (streamOk && ctxOk && vadAnalyserRef.current) return true;

    // 기존 context 정리
    if (vadContextRef.current && vadContextRef.current.state !== 'closed') {
      try { await vadContextRef.current.close(); } catch { /* ignore */ }
    }
    vadContextRef.current = null;
    vadAnalyserRef.current = null;

    try {
      if (!streamOk) {
        streamRef.current?.getTracks().forEach(t => t.stop());
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
        });
        streamRef.current = stream;
        mimeTypeRef.current = getSupportedMimeType();
      }
      const ctx = new AudioContext();
      await ctx.resume();
      vadContextRef.current = ctx;
      const source  = ctx.createMediaStreamSource(streamRef.current);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.8;
      source.connect(analyser);
      vadAnalyserRef.current = analyser;
      return true;
    } catch {
      return false;
    }
  }, []);

  const startMobileRecorder = useCallback(() => {
    if (isCapturingRef.current || !streamRef.current?.active) return;
    const mt = mimeTypeRef.current;
    const recorder = new MediaRecorder(streamRef.current, mt ? { mimeType: mt } : {});
    recorderRef.current    = recorder;
    audioChunksRef.current = [];
    recorder.ondataavailable = (e) => { if (e.data?.size > 0) audioChunksRef.current.push(e.data); };
    recorder.start(100);
    isCapturingRef.current = true;
  }, []);

  const sendMobileAudio = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;
    if (isTranscribingRef.current) return;

    isTranscribingRef.current = true;
    setIsTranscribing(true);
    isCapturingRef.current = false;

    recorder.onstop = async () => {
      const chunks   = audioChunksRef.current.splice(0);
      const mimeType = mimeTypeRef.current || recorder.mimeType || 'audio/webm';
      const blob     = chunks.length ? new Blob(chunks, { type: mimeType }) : null;
      try {
        if (!blob || blob.size < 1000) throw new Error('too short');
        const base64 = await blobToBase64(blob);
        const res = await fetch('/api/stt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ audio: base64, mimeType, contextPrompt: '' }),
        });
        if (!res.ok) throw new Error(`STT ${res.status}`);
        const { text } = await res.json();
        setLiveText('');
        if (text?.trim()) onResultRef.current?.(text.trim());
      } catch {
        setLiveText('');
      } finally {
        isTranscribingRef.current = false;
        setIsTranscribing(false);
      }
    };
    recorder.stop();
  }, []);

  const stopVADLoop = useCallback(() => {
    if (vadFrameRef.current) {
      cancelAnimationFrame(vadFrameRef.current);
      vadFrameRef.current = null;
    }
    clearTimeout(silenceVADTimer.current);
    silenceVADTimer.current = null;
    isSpeakingVAD.current = false;
  }, []);

  const startVADLoop = useCallback(() => {
    if (vadFrameRef.current) return;
    const analyser = vadAnalyserRef.current;
    if (!analyser) return;

    const bufLen  = analyser.frequencyBinCount;
    const dataBuf = new Uint8Array(bufLen);

    const tick = () => {
      if (!activeRef.current || pausedRef.current) {
        vadFrameRef.current = null;
        return;
      }
      vadFrameRef.current = requestAnimationFrame(tick);

      // 변환 대기 중에는 VAD 감지만 스킵 (루프는 유지)
      if (isTranscribingRef.current) return;

      // TTS 잔향 무시 구간
      if (Date.now() - lastResumeTimeRef.current < 300) return;

      analyser.getByteTimeDomainData(dataBuf);
      let sumSq = 0;
      for (let i = 0; i < bufLen; i++) {
        const n = (dataBuf[i] - 128) / 128;
        sumSq += n * n;
      }
      const rms = Math.sqrt(sumSq / bufLen) * 100;

      if (!isSpeakingVAD.current) {
        if (rms > VAD_SPEECH_THRESHOLD) {
          isSpeakingVAD.current   = true;
          speechStartTime.current = Date.now();
          clearTimeout(silenceVADTimer.current);
          silenceVADTimer.current = null;
          startMobileRecorder();
          setLiveText('● 녹음 중');
        }
      } else {
        if (rms < VAD_SILENCE_THRESHOLD) {
          if (!silenceVADTimer.current) {
            silenceVADTimer.current = setTimeout(() => {
              silenceVADTimer.current = null;
              if (!isSpeakingVAD.current) return;
              isSpeakingVAD.current = false;
              const dur = Date.now() - speechStartTime.current;
              if (dur >= VAD_MIN_SPEECH_MS) {
                setLiveText('');
                sendMobileAudio();
              } else {
                // 너무 짧음 — 노이즈로 판단, 버림
                const rec = recorderRef.current;
                if (rec && rec.state !== 'inactive') { rec.onstop = null; rec.stop(); }
                isCapturingRef.current = false;
                audioChunksRef.current = [];
                setLiveText('');
              }
            }, VAD_SILENCE_TIMEOUT);
          }
        } else {
          // 아직 말하는 중 — 침묵 타이머 취소
          clearTimeout(silenceVADTimer.current);
          silenceVADTimer.current = null;
        }
      }
    };

    vadFrameRef.current = requestAnimationFrame(tick);
  }, [startMobileRecorder, sendMobileAudio]);

  const startMobile = useCallback(async () => {
    if (activeRef.current) return;
    activeRef.current = true;
    pausedRef.current = false;
    const ok = await initMobileAudio();
    if (!ok) { activeRef.current = false; return; }
    setIsListening(true);
    startVADLoop();
  }, [initMobileAudio, startVADLoop]);

  const stopMobile = useCallback(() => {
    activeRef.current = false;
    pausedRef.current = false;
    stopVADLoop();
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') { rec.onstop = null; rec.stop(); }
    isCapturingRef.current = false;
    audioChunksRef.current = [];
    setIsListening(false);
    setLiveText('');
  }, [stopVADLoop]);

  const pauseMobile = useCallback(() => {
    pausedRef.current = true;
    isSpeakingVAD.current = false;
    clearTimeout(silenceVADTimer.current);
    silenceVADTimer.current = null;
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') { rec.onstop = null; rec.stop(); }
    isCapturingRef.current = false;
    audioChunksRef.current = [];
    setLiveText('');
  }, []);

  const resumeMobile = useCallback(() => {
    lastResumeTimeRef.current = Date.now();
    activeRef.current = true;
    pausedRef.current = false;
    isSpeakingVAD.current = false;
    startVADLoop();
  }, [startVADLoop]);

  // 컴포넌트 언마운트 시 오디오 리소스 정리
  useEffect(() => {
    if (!isMobileDevice) return;
    return () => {
      stopVADLoop();
      streamRef.current?.getTracks().forEach(t => t.stop());
      if (vadContextRef.current?.state !== 'closed') {
        vadContextRef.current?.close();
      }
    };
  }, [stopVADLoop]);

  // ══════════════════════════════════════════════════════════════════════════
  // PC PATH: SpeechRecognition (continuous) + MediaRecorder → Whisper
  // ══════════════════════════════════════════════════════════════════════════

  const startCapturePC = useCallback(async () => {
    if (isCapturingRef.current) return;
    try {
      if (!streamRef.current || streamRef.current.getTracks().some(t => t.readyState === 'ended')) {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
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

  const cancelCapturePC = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') { recorder.onstop = null; recorder.stop(); }
    isCapturingRef.current = false;
    audioChunksRef.current = [];
  }, []);

  const releaseStreamPC = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }, []);

  const sendToWhisperPC = useCallback((fallbackText) => {
    if (isTranscribingRef.current) return;
    const recorder  = recorderRef.current;
    const capturing = isCapturingRef.current;

    if (!recorder || recorder.state === 'inactive' || !capturing) {
      if (recorder && recorder.state !== 'inactive') { recorder.onstop = null; recorder.stop(); }
      isCapturingRef.current = false;
      audioChunksRef.current = [];
      setLiveText('');
      if (fallbackText) onResultRef.current?.(fallbackText);
      return;
    }

    isTranscribingRef.current = true;
    setIsTranscribing(true);
    isCapturingRef.current = false;

    recorder.onstop = async () => {
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
        setLiveText('');
        onResultRef.current?.(text?.trim() || fallbackText || '');
      } catch {
        setLiveText('');
        if (fallbackText) onResultRef.current?.(fallbackText);
      } finally {
        isTranscribingRef.current = false;
        setIsTranscribing(false);
      }
    };
    recorder.stop();
  }, []);

  const flushAccumulatedPC = useCallback(() => {
    clearTimeout(submitTimerRef.current);
    const text = accumulatedRef.current.trim() || latestInterimRef.current.trim();
    accumulatedRef.current   = '';
    latestInterimRef.current = '';
    lastAddedTextRef.current = '';
    setLiveText(text || '');

    if (text && activeRef.current && !pausedRef.current) {
      lastSubmittedTextRef.current = text;
      lastSubmittedTimeRef.current = Date.now();
      pausedRef.current = true;
      cancelCapturePC();
      sendToWhisperPC(text);
    }
  }, [sendToWhisperPC, cancelCapturePC]);

  const resetSubmitTimerPC = useCallback(() => {
    clearTimeout(submitTimerRef.current);
    submitTimerRef.current = setTimeout(flushAccumulatedPC, SILENCE_TIMEOUT);
  }, [flushAccumulatedPC]);

  const createAndStartPC = useCallback(() => {
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
            const isDup = t === lastSubmittedTextRef.current &&
              (Date.now() - lastSubmittedTimeRef.current) < DEDUP_WINDOW_MS;
            if (isDup) { resetSubmitTimerPC(); continue; }
            if (t && t !== lastAddedTextRef.current) {
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
            resetSubmitTimerPC();
          }
        } else {
          interim += event.results[i][0].transcript;
        }
      }
      if (interim) resetSubmitTimerPC();
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
  }, [resetSubmitTimerPC, flushAccumulatedPC]);

  createAndStartRef.current = createAndStartPC;

  const stopPC = useCallback(() => {
    clearTimeout(submitTimerRef.current);
    generationRef.current++;
    activeRef.current = pausedRef.current = false;
    accumulatedRef.current = latestInterimRef.current = lastAddedTextRef.current = '';
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setIsListening(false);
    setLiveText('');
    cancelCapturePC();
    releaseStreamPC();
  }, [cancelCapturePC, releaseStreamPC]);

  const startPC = useCallback(() => {
    if (activeRef.current) return;
    clearTimeout(submitTimerRef.current);
    accumulatedRef.current = latestInterimRef.current = lastAddedTextRef.current = '';
    activeRef.current = true;
    pausedRef.current = false;
    createAndStartPC();
    startCapturePC();
  }, [createAndStartPC, startCapturePC]);

  const pausePC = useCallback(() => {
    clearTimeout(submitTimerRef.current);
    accumulatedRef.current = latestInterimRef.current = lastAddedTextRef.current = '';
    pausedRef.current = true;
    cancelCapturePC();
    setLiveText('');
  }, [cancelCapturePC]);

  const resumePC = useCallback(() => {
    clearTimeout(submitTimerRef.current);
    accumulatedRef.current = latestInterimRef.current = lastAddedTextRef.current = '';
    lastResumeTimeRef.current = Date.now();
    activeRef.current = true;
    pausedRef.current = false;
    if (!recognitionRef.current) createAndStartPC();
    startCapturePC();
  }, [createAndStartPC, startCapturePC]);

  // ══════════════════════════════════════════════════════════════════════════
  // Public interface
  // ══════════════════════════════════════════════════════════════════════════

  if (isMobileDevice) {
    return {
      isListening: isListening || isTranscribing,
      liveText,
      toggle: () => { if (activeRef.current) stopMobile(); else startMobile(); },
      start:  startMobile,
      stop:   stopMobile,
      pause:  pauseMobile,
      resume: resumeMobile,
    };
  }

  return {
    isListening: isListening || isTranscribing,
    liveText,
    toggle: () => { if (activeRef.current) stopPC(); else startPC(); },
    start:  startPC,
    stop:   stopPC,
    pause:  pausePC,
    resume: resumePC,
  };
}
