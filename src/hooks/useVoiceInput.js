// useVoiceInput v9 — stream-persistent Whisper STT
// Same interface as v7 (Web Speech API): { isListening, liveText, toggle, start, stop, pause, resume }
// useVoiceChat.js unchanged.

import { useState, useRef, useCallback, useEffect } from 'react';
import { useMediaRecorder } from './useMediaRecorder';

export function useVoiceInput(onResult) {
  const [liveText, setLiveText] = useState('');

  const activeRef   = useRef(false);
  const onResultRef = useRef(onResult);
  useEffect(() => { onResultRef.current = onResult; }, [onResult]);

  const handleResult = useCallback((text) => {
    setLiveText('');
    if (!activeRef.current) return;
    onResultRef.current?.(text);
  }, []);

  const handleError = useCallback((msg) => {
    console.warn('[useVoiceInput] STT error:', msg);
  }, []);

  const {
    isRecording, isTranscribing,
    startRecording, cancel, fullStop,
  } = useMediaRecorder({ onResult: handleResult, onError: handleError });

  const isListening = isRecording || isTranscribing;

  // start: first activation — opens the microphone stream (user-gesture required)
  const start = useCallback(() => {
    if (activeRef.current) return;
    activeRef.current = true;
    startRecording();
  }, [startRecording]);

  // stop: end of conversation — release microphone stream entirely
  const stop = useCallback(() => {
    activeRef.current = false;
    fullStop();
    setLiveText('');
  }, [fullStop]);

  // pause: between AI turns — stop recorder but KEEP stream alive
  // Stream reuse prevents mobile AGC re-init that caused premature cutoff
  const pause = useCallback(() => {
    cancel();
    setLiveText('');
  }, [cancel]);

  // resume: restart recording on the existing warm stream
  const resume = useCallback(() => {
    activeRef.current = true;
    startRecording();
  }, [startRecording]);

  const toggle = useCallback(() => {
    if (activeRef.current) stop();
    else start();
  }, [stop, start]);

  return { isListening, liveText, toggle, start, stop, pause, resume };
}
