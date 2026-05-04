// useMediaRecorder.js v5
//
// Root cause of premature cutoff (found after v4 still failed):
//   Every recording session called getUserMedia() → new stream.
//   On mobile, the 2nd getUserMedia triggers AGC/noise-suppression re-init.
//   During ~800ms init window the signal is near-zero → silence zone arms
//   immediately → timer fires way too early.
//
// Fix: open the stream ONCE (from the first user-gesture call) and keep it
// alive for the entire conversation.  Only release on explicit fullStop().
//
//   cancel()    — stop MediaRecorder, keep stream alive
//   _doStop()   — stop MediaRecorder, run Whisper, keep stream alive
//   fullStop()  — cancel() + releaseStream()   (called by useVoiceInput.stop)
//
// Silence detection — 3-zone hysteresis (unchanged from v4):
//   Zone A  rms >= 20   : speech  → reset silence debounce/timer
//   Zone B  5 < rms < 20: ambient → reset silence debounce/timer
//   Zone C  rms <= 5    : silence → after 1.2 s debounce, arm 5 s timer

import { useState, useRef, useCallback } from 'react';

const SPEECH_THRESHOLD   = 20;
const SILENCE_THRESHOLD  = 5;
const SILENCE_LEADING_MS = 1200;
const SILENCE_DURATION   = 5000;
const MIN_RECORD_MS      = 800;

function getSupportedMimeType() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
    'audio/ogg',
  ];
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return '';
}

export function useMediaRecorder({ onResult, onError, getContextPrompt }) {
  const [isRecording,    setIsRecording]    = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);

  const isRecordingRef    = useRef(false);
  const isTranscribingRef = useRef(false);

  const mediaRecorderRef  = useRef(null);
  const chunksRef         = useRef([]);
  const streamRef         = useRef(null);   // ← persists across sessions
  const mimeTypeRef       = useRef('');
  const audioCtxRef       = useRef(null);
  const analyserRef       = useRef(null);
  const silenceTimerRef   = useRef(null);
  const rafRef            = useRef(null);
  const hasSpokenRef      = useRef(false);
  const startTimeRef      = useRef(0);
  const stoppingRef       = useRef(false);
  const silenceStartRef   = useRef(null);

  const setRecording = useCallback((val) => {
    isRecordingRef.current = val;
    setIsRecording(val);
  }, []);

  const setTranscribing = useCallback((val) => {
    isTranscribingRef.current = val;
    setIsTranscribing(val);
  }, []);

  // Releases microphone stream — call only on full stop (end of conversation).
  const releaseStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
  }, []);

  const releaseAudioCtx = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    clearTimeout(silenceTimerRef.current);
    rafRef.current          = null;
    silenceTimerRef.current = null;
    silenceStartRef.current = null;
    try { audioCtxRef.current?.close(); } catch {}
    audioCtxRef.current = null;
    analyserRef.current = null;
  }, []);

  const _doStop = useCallback(async () => {
    if (stoppingRef.current) return;
    stoppingRef.current = true;

    releaseAudioCtx();

    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') {
      stoppingRef.current = false;
      return;
    }

    recorder.onstop = async () => {
      // Stream intentionally NOT released here — reused by next startRecording().
      setRecording(false);

      const chunks = chunksRef.current;
      if (!chunks.length || !hasSpokenRef.current) {
        stoppingRef.current = false;
        return;
      }

      const mimeType = mimeTypeRef.current || recorder.mimeType || 'audio/webm';
      const blob = new Blob(chunks, { type: mimeType });
      if (blob.size < 3000) { stoppingRef.current = false; return; }

      setTranscribing(true);
      try {
        const base64 = await blobToBase64(blob);
        const contextPrompt = getContextPrompt?.() ?? '';
        const res = await fetch('/api/stt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ audio: base64, mimeType, contextPrompt }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: res.statusText }));
          throw new Error(err.error || `STT error ${res.status}`);
        }
        const { text } = await res.json();
        if (text?.trim()) onResult?.(text.trim());
      } catch (err) {
        onError?.('STT error: ' + err.message);
      } finally {
        setTranscribing(false);
        chunksRef.current = [];
        stoppingRef.current = false;
      }
    };

    recorder.stop();
  }, [releaseAudioCtx, getContextPrompt, onResult, onError, setRecording, setTranscribing]);

  const startSilenceDetection = useCallback((stream) => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;

      const ctx      = new AudioCtx();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      ctx.createMediaStreamSource(stream).connect(analyser);

      audioCtxRef.current = ctx;
      analyserRef.current = analyser;
      const data = new Uint8Array(analyser.frequencyBinCount);

      const resetSilence = () => {
        silenceStartRef.current = null;
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      };

      const check = () => {
        rafRef.current = requestAnimationFrame(check);
        analyser.getByteTimeDomainData(data);

        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += (data[i] - 128) ** 2;
        const rms = Math.sqrt(sum / data.length);

        const elapsed = Date.now() - startTimeRef.current;

        if (rms >= SPEECH_THRESHOLD) {
          hasSpokenRef.current = true;
          resetSilence();
        } else if (rms > SILENCE_THRESHOLD) {
          if (hasSpokenRef.current) resetSilence();
        } else {
          if (hasSpokenRef.current && elapsed > MIN_RECORD_MS) {
            if (!silenceStartRef.current) silenceStartRef.current = Date.now();
            const led = Date.now() - silenceStartRef.current;
            if (led >= SILENCE_LEADING_MS && !silenceTimerRef.current) {
              silenceTimerRef.current = setTimeout(() => { _doStop(); }, SILENCE_DURATION);
            }
          }
        }
      };
      check();
    } catch {}
  }, [_doStop]);

  const startRecording = useCallback(async () => {
    if (isRecordingRef.current || isTranscribingRef.current) return;
    if (stoppingRef.current) return;

    hasSpokenRef.current    = false;
    silenceStartRef.current = null;
    stoppingRef.current     = false;
    chunksRef.current       = [];
    startTimeRef.current    = Date.now();

    try {
      // Reuse existing stream if alive — avoids repeated getUserMedia on mobile.
      // Mobile browsers re-init AGC/noise-suppression on every new getUserMedia,
      // causing ~800ms of near-zero signal that falsely arms the silence timer.
      if (!streamRef.current) {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl:  false, // OFF — prevents post-speech gain drop
          },
        });
        streamRef.current = stream;
        mimeTypeRef.current = getSupportedMimeType();
      }

      const stream   = streamRef.current;
      const mimeType = mimeTypeRef.current;

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data?.size > 0) chunksRef.current.push(e.data);
      };

      recorder.start(100);
      setRecording(true);
      startSilenceDetection(stream);
    } catch (err) {
      const msg = err.name === 'NotAllowedError'
        ? 'Microphone permission required.'
        : 'Could not start microphone: ' + err.message;
      onError?.(msg);
    }
  }, [startSilenceDetection, onError, setRecording]);

  const stopRecording = useCallback(() => { _doStop(); }, [_doStop]);

  const toggle = useCallback(() => {
    if (isRecordingRef.current) stopRecording();
    else startRecording();
  }, [startRecording, stopRecording]);

  // Soft cancel — stop recorder WITHOUT releasing the stream.
  // Used by pause() between AI turns so the stream stays warm for resume().
  const cancel = useCallback(() => {
    releaseAudioCtx();
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.onstop = null;
      recorder.stop();
    }
    mediaRecorderRef.current = null;
    chunksRef.current        = [];
    hasSpokenRef.current     = false;
    silenceStartRef.current  = null;
    stoppingRef.current      = false;
    setRecording(false);
  }, [releaseAudioCtx, setRecording]);

  // Full stop — cancel + release stream. Call when conversation ends (stop()).
  const fullStop = useCallback(() => {
    cancel();
    releaseStream();
  }, [cancel, releaseStream]);

  return {
    isRecording, isTranscribing,
    toggle, startRecording, stopRecording,
    cancel, fullStop,
  };
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(',')[1]);
    reader.onerror   = reject;
    reader.readAsDataURL(blob);
  });
}
