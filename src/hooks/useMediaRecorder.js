// useMediaRecorder.js v2
// Auto-sends after 5s silence. Refs mirror state to avoid stale closure bugs.
// cancel() stops recording immediately without Whisper (used by speakThenResume/sendMessage)

import { useState, useRef, useCallback } from 'react';

const SILENCE_THRESHOLD = 8;
const SILENCE_DURATION  = 5000;
const MIN_RECORD_MS     = 800;

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
  const [isRecording,     setIsRecording]     = useState(false);
  const [isTranscribing,  setIsTranscribing]  = useState(false);

  // Mirror state in refs so startRecording guard never reads stale closure values
  const isRecordingRef    = useRef(false);
  const isTranscribingRef = useRef(false);

  const mediaRecorderRef = useRef(null);
  const chunksRef        = useRef([]);
  const streamRef        = useRef(null);
  const mimeTypeRef      = useRef('');
  const audioCtxRef      = useRef(null);
  const analyserRef      = useRef(null);
  const silenceTimerRef  = useRef(null);
  const rafRef           = useRef(null);
  const hasSpokenRef     = useRef(false);
  const startTimeRef     = useRef(0);
  const stoppingRef      = useRef(false);

  const setRecording = useCallback((val) => {
    isRecordingRef.current = val;
    setIsRecording(val);
  }, []);

  const setTranscribing = useCallback((val) => {
    isTranscribingRef.current = val;
    setIsTranscribing(val);
  }, []);

  const releaseStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
  }, []);

  const releaseAudioCtx = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    clearTimeout(silenceTimerRef.current);
    rafRef.current = null;
    silenceTimerRef.current = null;
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
      releaseStream();
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
  }, [releaseAudioCtx, releaseStream, getContextPrompt, onResult, onError, setRecording, setTranscribing]);

  const startSilenceDetection = useCallback((stream) => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;

      const ctx      = new AudioCtx();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);

      audioCtxRef.current  = ctx;
      analyserRef.current  = analyser;
      const data = new Uint8Array(analyser.frequencyBinCount);

      const check = () => {
        rafRef.current = requestAnimationFrame(check);
        analyser.getByteTimeDomainData(data);

        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += (data[i] - 128) ** 2;
        const rms = Math.sqrt(sum / data.length);

        const elapsed = Date.now() - startTimeRef.current;

        if (rms > SILENCE_THRESHOLD) {
          hasSpokenRef.current = true;
          clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = null;
        } else if (hasSpokenRef.current && elapsed > MIN_RECORD_MS) {
          if (!silenceTimerRef.current) {
            silenceTimerRef.current = setTimeout(() => { _doStop(); }, SILENCE_DURATION);
          }
        }
      };
      check();
    } catch {}
  }, [_doStop]);

  const startRecording = useCallback(async () => {
    // Use refs (not state) to avoid stale closure reads
    if (isRecordingRef.current || isTranscribingRef.current) return;
    if (stoppingRef.current) return;

    hasSpokenRef.current  = false;
    stoppingRef.current   = false;
    chunksRef.current     = [];
    startTimeRef.current  = Date.now();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl:  true,
          sampleRate: 16000,
        },
      });

      streamRef.current = stream;

      const mimeType = getSupportedMimeType();
      mimeTypeRef.current = mimeType;

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data?.size > 0) chunksRef.current.push(e.data);
      };

      recorder.start(100);
      setRecording(true);
      startSilenceDetection(stream);
    } catch (err) {
      releaseStream();
      const msg = err.name === 'NotAllowedError'
        ? 'Microphone permission required. Please allow microphone access in browser settings.'
        : 'Could not start microphone: ' + err.message;
      onError?.(msg);
    }
  }, [releaseStream, startSilenceDetection, onError, setRecording]);

  const stopRecording = useCallback(() => { _doStop(); }, [_doStop]);

  const toggle = useCallback(() => {
    if (isRecordingRef.current) stopRecording();
    else startRecording();
  }, [startRecording, stopRecording]);

  // Hard cancel - stops recording without sending to Whisper
  // Called by speakThenResume() and sendMessage() before TTS/AI processing
  const cancel = useCallback(() => {
    releaseAudioCtx();
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.onstop = null;
      recorder.stop();
    }
    releaseStream();
    chunksRef.current    = [];
    hasSpokenRef.current = false;
    stoppingRef.current  = false;
    setRecording(false);
  }, [releaseAudioCtx, releaseStream, setRecording]);

  return { isRecording, isTranscribing, toggle, startRecording, stopRecording, cancel };
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(',')[1]);
    reader.onerror   = reject;
    reader.readAsDataURL(blob);
  });
}
