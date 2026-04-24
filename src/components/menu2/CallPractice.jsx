import { useState, useRef, useEffect } from 'react';
import { Phone, ChevronDown, ChevronUp, Loader2, Volume2 } from 'lucide-react';
import NavBar from '../NavBar';
import FeedbackModal from '../FeedbackModal';
import { generateCallScript, startPersonaChat, generateFeedback } from '../../services/geminiService';
import { useVoiceChat } from '../../hooks/useVoiceChat';
import { playRingTone, unlockAudio } from '../../services/ttsService';
import { MicButton, SendButton, TtsButton, Bubble, ThinkingBubble } from '../menu1/SpeechPractice';

const PERSONALITIES = ['까다로운형', '바쁜형', '친절한형', '의심형', '직접입력'];

export default function CallPractice() {
  const [step, setStep] = useState('form');
  const [form, setForm] = useState({ product: '', profile: '', personality: '까다로운형', customPersonality: '', painPoints: '' });
  const [script, setScript] = useState('');
  const [scriptOpen, setScriptOpen] = useState(false);
  const [timer, setTimer] = useState(0);
  const [startLoading, setStartLoading] = useState(false);
  const [startError, setStartError] = useState('');
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [showFeedback, setShowFeedback] = useState(false);
  const chatRef = useRef(null);
  const timerRef = useRef(null);
  const messagesEndRef = useRef(null);

  const personality = form.personality === '직접입력' ? form.customPersonality : form.personality;

  const {
    messages, setMessages,
    input, setInput,
    loading, error,
    ttsEnabled, toggleTts,
    isListening, liveText,
    toggleMic, stopMic, speakThenResume,
    sendMessage,
  } = useVoiceChat({
    chatRef,
    product: form.product,
    profile: form.profile,
    personality,
    ttsStorageKey: 'sales_call_tts_enabled',
    defaultTts: true,
  });

  useEffect(() => {
    if (step === 'call') {
      timerRef.current = setInterval(() => setTimer(t => t + 1), 1000);
    }
    return () => clearInterval(timerRef.current);
  }, [step]);

  useEffect(() => {
    const t = setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    return () => clearTimeout(t);
  }, [messages]);

  const formatTime = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  async function handleGenerateScript() {
    if (!form.product.trim() || !form.profile.trim()) {
      setStartError('판매 상품명과 고객 프로필을 입력해주세요.');
      return;
    }
    setStartLoading(true);
    setStartError('');
    try {
      const text = await generateCallScript(form.product, form.profile, personality, form.painPoints);
      setScript(text);
      setStep('script');
    } catch (e) {
      setStartError(e.message);
    } finally {
      setStartLoading(false);
    }
  }

  async function handleStartCall() {
    unlockAudio(); // 사용자 제스처 시점에 오디오 잠금 해제
    setStartLoading(true);
    try {
      const chat = await startPersonaChat(form.product, form.profile + ' (1~2문장으로 짧게 응답)', personality, form.painPoints, 'call');
      chatRef.current = chat;
      const result = await chat.sendMessage('여보세요?');
      const aiText = result.response.text();
      setMessages([{ role: 'model', text: aiText }]);
      setStep('call');
      // 전화벨 2번 → 고객 첫마디 → TTS ON: 재생 후 마이크 / OFF: 즉시 마이크 활성화
      playRingTone(() => speakThenResume(aiText));
    } catch (e) {
      setStartError(e.message);
    } finally {
      setStartLoading(false);
    }
  }

  async function handleFeedback() {
    stopMic();
    setFeedbackLoading(true);
    setShowFeedback(true);
    setFeedback(null);
    try {
      const data = await generateFeedback(messages);
      setFeedback(data);
    } catch (e) {
      setFeedback({ score: 0, summary: '피드백 생성 오류', good: [], improve: [e.message], scripts: [] });
    } finally {
      setFeedbackLoading(false);
    }
  }

  if (step === 'form') {
    return (
      <div className="min-h-screen bg-slate-50">
        <NavBar title="세일즈 전화 연습" />
        <div className="max-w-2xl mx-auto px-4 py-8">
          <h2 className="text-2xl font-bold text-slate-800 mb-1">세일즈 전화 연습</h2>
          <p className="text-slate-500 text-sm mb-6">TA 스크립트를 생성하고 전화 영업을 연습하세요</p>
          {startError && <div className="bg-red-50 border border-red-300 text-red-700 px-4 py-3 rounded-xl mb-4 text-sm">{startError}</div>}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-5">
            <F label="판매 상품명"><input className={I} placeholder="예: 기업 맞춤형 HR 솔루션" value={form.product} onChange={e => setForm(f => ({ ...f, product: e.target.value }))} /></F>
            <F label="고객 프로필"><textarea rows={3} className={T} placeholder="예: 45세 남성, 중소기업 대표, 직원 30명, 제조업" value={form.profile} onChange={e => setForm(f => ({ ...f, profile: e.target.value }))} /></F>
            <F label="고객 성격">
              <select className={S} value={form.personality} onChange={e => setForm(f => ({ ...f, personality: e.target.value }))}>
                {PERSONALITIES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              {form.personality === '직접입력' && <input className={`mt-2 ${I}`} placeholder="성격 유형을 직접 입력하세요" value={form.customPersonality} onChange={e => setForm(f => ({ ...f, customPersonality: e.target.value }))} />}
            </F>
            <F label="고객 애로사항"><textarea rows={3} className={T} placeholder="예: 직원 채용·관리에 시간이 너무 많이 걸림" value={form.painPoints} onChange={e => setForm(f => ({ ...f, painPoints: e.target.value }))} /></F>
            <button onClick={handleGenerateScript} disabled={startLoading} className="w-full bg-amber-500 hover:bg-amber-400 disabled:bg-slate-200 disabled:text-slate-400 text-white font-bold py-4 rounded-xl transition-colors flex items-center justify-center gap-2 shadow-sm">
              {startLoading ? <><Loader2 size={20} className="animate-spin" /> 스크립트 생성 중...</> : '📋 스크립트 생성'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'script') {
    return (
      <div className="min-h-screen bg-slate-50">
        <NavBar title="세일즈 전화 연습" />
        <div className="max-w-2xl mx-auto px-4 py-8">
          <h2 className="text-2xl font-bold text-slate-800 mb-1">TA 스크립트</h2>
          <p className="text-slate-500 text-sm mb-5">스크립트를 확인하고 연습을 시작하세요.</p>
          <div className="space-y-3 mb-6 max-h-[60vh] overflow-y-auto pr-1">
            <ScriptSections script={script} />
          </div>
          <div className="flex gap-3">
            <button onClick={() => setStep('form')} className="flex-1 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 font-medium py-4 rounded-xl transition-colors shadow-sm">다시 생성</button>
            <button onClick={handleStartCall} disabled={startLoading} className="flex-grow bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-200 text-white font-bold py-4 rounded-xl transition-colors flex items-center justify-center gap-2 shadow-sm">
              {startLoading ? <><Loader2 size={20} className="animate-spin" /> 준비 중...</> : <><Phone size={20} /> 연습하기</>}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <NavBar title="세일즈 전화 연습" />

      {/* 통화 헤더 */}
      <div className="bg-emerald-600 text-white px-4 py-3 shadow-md">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center">
              <Phone size={17} className="text-white" />
            </div>
            <div>
              <p className="font-semibold text-sm">통화 중 · {form.product}</p>
              <p className="text-emerald-100 text-xs font-mono">{formatTime(timer)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={toggleTts}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${ttsEnabled ? 'bg-white/20 text-white' : 'bg-white/10 text-emerald-200'}`}
            >
              <Volume2 size={13} />
              <span>{ttsEnabled ? '음성 ON' : '음성 OFF'}</span>
            </button>
            <button onClick={handleFeedback} className="bg-white text-emerald-700 text-sm font-bold px-4 py-1.5 rounded-lg hover:bg-emerald-50 shadow-sm transition-colors">
              피드백
            </button>
          </div>
        </div>
      </div>

      {/* 스크립트 참고 */}
      <div className="max-w-2xl w-full mx-auto px-4 pt-3">
        <button
          onClick={() => setScriptOpen(o => !o)}
          className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 flex items-center justify-between text-slate-600 text-sm hover:bg-slate-50 transition-colors shadow-sm"
        >
          <span className="font-medium">📋 스크립트 참고</span>
          {scriptOpen ? <ChevronUp size={15} className="text-slate-400" /> : <ChevronDown size={15} className="text-slate-400" />}
        </button>
        {scriptOpen && (
          <div className="border border-slate-200 border-t-0 rounded-b-xl overflow-hidden shadow-sm">
            <div className="max-h-52 overflow-y-auto bg-slate-50 px-3 py-3 space-y-2">
              <ScriptSections script={script} compact />
            </div>
          </div>
        )}
      </div>

      {/* 대화창 */}
      <div className="flex-1 overflow-y-auto max-w-2xl w-full mx-auto px-4 py-4 space-y-3">
        {messages.map((m, i) => (
          <Bubble key={i} m={m} personality={personality} profile={form.profile} />
        ))}
        {loading && <ThinkingBubble color="green" />}
        {error && <p className="text-red-500 text-xs text-center">{error}</p>}
        <div ref={messagesEndRef} />
      </div>

      {/* 입력창 */}
      <div className="bg-white border-t border-slate-200 px-4 py-3 max-w-2xl w-full mx-auto">
        <div className="flex gap-2">
          <MicButton isListening={isListening} onClick={toggleMic} />
          <input
            className="flex-1 border border-slate-300 rounded-xl px-4 py-3 text-slate-800 placeholder-slate-400 focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition-all text-sm"
            placeholder={isListening ? '🎤 말씀하세요...' : '메시지를 입력하거나 마이크를 누르세요'}
            value={isListening ? liveText : input}
            onChange={e => { if (!isListening) setInput(e.target.value); }}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
          />
          <SendButton onClick={() => sendMessage()} disabled={loading || !(isListening ? liveText : input).trim()} color="green" />
        </div>
      </div>

      <FeedbackModal
        show={showFeedback}
        onClose={() => setShowFeedback(false)}
        loading={feedbackLoading}
        feedback={feedback}
        title="통화 피드백"
      />
    </div>
  );
}

const I = 'w-full border border-slate-300 rounded-xl px-4 py-3 text-slate-800 placeholder-slate-400 focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition-all';
const T = `${I} resize-none`;
const S = 'w-full border border-slate-300 rounded-xl px-4 py-3 text-slate-800 focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition-all bg-white';
function F({ label, children }) { return <div><label className="block text-slate-700 text-sm font-semibold mb-2">{label}</label>{children}</div>; }

// 스크립트 텍스트를 ## 섹션 단위로 파싱해 깔끔하게 렌더링
function ScriptSections({ script, compact = false }) {
  const sections = script
    .split(/\n(?=##\s)/)
    .map(s => s.trim())
    .filter(Boolean);

  if (sections.length <= 1) {
    // 파싱 실패 시 plain fallback
    return <p className="text-slate-600 text-xs leading-relaxed whitespace-pre-wrap">{script}</p>;
  }

  return sections.map((sec, i) => {
    const firstNewline = sec.indexOf('\n');
    const header = firstNewline === -1 ? sec : sec.slice(0, firstNewline);
    const body = firstNewline === -1 ? '' : sec.slice(firstNewline + 1).trim();
    const title = header.replace(/^##\s*/, '').trim();

    if (compact) {
      return (
        <div key={i} className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <div className="px-3 py-1.5 bg-emerald-50 border-b border-slate-100">
            <p className="text-emerald-700 font-semibold text-xs">{title}</p>
          </div>
          <div className="px-3 py-2">
            <p className="text-slate-600 text-xs leading-relaxed whitespace-pre-wrap">{body}</p>
          </div>
        </div>
      );
    }

    return (
      <div key={i} className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
        <div className="px-4 py-2.5 bg-emerald-50 border-b border-emerald-100">
          <p className="text-emerald-800 font-bold text-sm">{title}</p>
        </div>
        <div className="px-4 py-3">
          <p className="text-slate-700 text-sm leading-relaxed whitespace-pre-wrap">{body}</p>
        </div>
      </div>
    );
  });
}
