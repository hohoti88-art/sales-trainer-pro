// useVoiceInput v8 — Whisper STT (gpt-4o-mini-transcribe)
// MediaRecorder + 5s silence detection -> /api/stt -> onResult(text)
// Same external interface as v7 (Web Speech API):
//   { isListening, liveText, toggle, start, stop, pause, resume }
// useVoiceChat.js does NOT need to change.

import { useState, useRef, useCallback, useEffect } from 'react';
import { useMediaRecorder } from './useMediaRecorder';

export function useVoiceInput(onResult) {
  const [liveText, setLiveText] = useState('');

  // activeRef: true = user wants mic on (survives pause/resume cycles)
  //            false = user explicitly stopped mic (toggle off or stop())
  const activeRef   = useRef(false);
  const onResultRef = useRef(onResult);
  useEffect(() => { onResultRef.current = onResult; }, [onResult]);

  // Called by useMediaRecorder after Whisper returns transcribed text.
  // At this point the recorder has already stopped (audio was sent to Whisper).
  // useVoiceChat.sendMessage() will call pauseMic() right after onResult fires,
  // which calls cancel() below — safe no-op since recording is already inactive.
  const handleResult = useCallback((text) => {
    setLiveText('');
    if (!activeRef.current) return; // stop() was called during transcription
    onResultRef.current?.(text);
  }, []);

  const handleError = useCallback((msg) => {
    console.warn('[useVoiceInput] STT error:', msg);
  }, []);

  const { isRecording, isTranscribing, startRecording, cancel } = useMediaRecorder({
    onResult: handleResult,
    onError: handleError,
  });

  // isListening = true while mic is open (recording) OR while waiting for Whisper.
  // Both phases lock the input field to liveText (empty during Whisper wait is fine —
  // the placeholder "말씀하세요..." is visible).
  const isListening = isRecording || isTranscribing;

  // start: activate mic from a fully stopped state (e.g. first toggle-on)
  const start = useCallback(() => {
    if (activeRef.current) return;
    activeRef.current = true;
    startRecording();
  }, [startRecording]);

  // stop: fully deactivate mic (user toggle-off or session end)
  const stop = useCallback(() => {
    activeRef.current = false;
    cancel();
    setLiveText('');
  }, [cancel]);

  // pause: discard current audio, stop mic, do NOT send to Whisper.
  // Called by sendMessage() before AI processing begins.
  // Does NOT clear activeRef — resume() will restart mic afterwards.
  const pause = useCallback(() => {
    cancel();
    setLiveText('');
  }, [cancel]);

  // resume: restart mic after TTS finishes (called by speakThenResume).
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
