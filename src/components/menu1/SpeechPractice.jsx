import { useState, useRef, useEffect } from 'react';
import { Send, User, Bot, Loader2, Mic, MicOff, Volume2, VolumeX } from 'lucide-react';
import NavBar from '../NavBar';
import FeedbackModal from '../FeedbackModal';
import { startPersonaChat, generateFeedback } from '../../services/geminiService';
import { useVoiceChat } from '../../hooks/useVoiceChat';
import { speak, unlockAudio } from '../../services/ttsService';

const PERSONALITIES = ['까다로운형', '바쁜형', '친절한형', '의심형', '직접입력'];

export default function SpeechPractice() {
  const [step, setStep] = useState('form');
  const [form, setForm] = useState({ product: '', profile: '', personality: '까다로운형', customPersonality: '', painPoints: '' });
  const [startLoading, setStartLoading] = useState(false);
  const [startError, setStartError] = useState('');
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [showFeedback, setShowFeedback] = useState(false);
  const chatRef = useRef(null);
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
    ttsStorageKey: 'sales_tts_enabled',
    defaultTts: true,
  });

  // 메시지 추가될 때마다 스크롤 (useEffect로 DOM 업데이트 후 실행 보장)
  const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  useEffect(() => {
    const t = setTimeout(scrollToBottom, 100);
    return () => clearTimeout(t);
  }, [messages]);

  async function handleStart() {
    if (!form.product.trim() || !form.profile.trim()) {
      setStartError('판매 상품명과 고객 프로필을 입력해주세요.');
      return;
    }
    unlockAudio(); // 사용자 제스처 시점에 오디오 잠금 해제
    setStartLoading(true);
    setStartError('');
    try {
      const chat = await startPersonaChat(form.product, form.profile, personality, form.painPoints);
      chatRef.current = chat;
      const result = await chat.sendMessage('안녕하세요, 저는 영업사원입니다. 잠깐 시간 괜찮으신가요?');
      const aiText = result.response.text();
      setMessages([{ role: 'model', text: aiText }]);
      setStep('chat');
      speakThenResume(aiText); // TTS ON: 재생→마이크 / OFF: 즉시 마이크 활성화
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
        <NavBar title="세일즈 화법 연습" />
        <div className="max-w-2xl mx-auto px-4 py-8">
          <h2 className="text-2xl font-bold text-slate-800 mb-1">세일즈 화법 연습</h2>
          <p className="text-slate-500 text-sm mb-6">AI 고객과 대화하며 실전 화법을 연습하세요</p>
          {startError && <div className="bg-red-50 border border-red-300 text-red-700 px-4 py-3 rounded-xl mb-4 text-sm">{startError}</div>}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-5">
            <Field label="판매 상품명">
              <input className={INPUT} placeholder="예: 기업 맞춤형 HR 솔루션" value={form.product} onChange={e => setForm(f => ({ ...f, product: e.target.value }))} />
            </Field>
            <Field label="고객 프로필">
              <textarea rows={3} className={TEXTAREA} placeholder="예: 45세 남성, 중소기업 대표, 직원 30명, 제조업" value={form.profile} onChange={e => setForm(f => ({ ...f, profile: e.target.value }))} />
            </Field>
            <Field label="고객 성격">
              <select className={SELECT} value={form.personality} onChange={e => setForm(f => ({ ...f, personality: e.target.value }))}>
                {PERSONALITIES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              {form.personality === '직접입력' && (
                <input className={`mt-2 ${INPUT}`} placeholder="성격 유형을 직접 입력하세요" value={form.customPersonality} onChange={e => setForm(f => ({ ...f, customPersonality: e.target.value }))} />
              )}
            </Field>
            <Field label="고객 애로사항">
              <textarea rows={3} className={TEXTAREA} placeholder="예: 직원 채용·관리에 시간이 너무 많이 걸림" value={form.painPoints} onChange={e => setForm(f => ({ ...f, painPoints: e.target.value }))} />
            </Field>
            <button onClick={handleStart} disabled={startLoading} className="w-full bg-amber-500 hover:bg-amber-400 disabled:bg-slate-200 disabled:text-slate-400 text-white font-bold py-4 rounded-xl transition-colors flex items-center justify-center gap-2 shadow-sm">
              {startLoading ? <><Loader2 size={20} className="animate-spin" /> 페르소나 생성 중...</> : '🗣️ 대화 시작'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <NavBar title="세일즈 화법 연습" />

      {/* 상단 바 */}
      <div className="bg-white border-b border-slate-200 px-4 py-3 shadow-sm">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center">
              <Bot size={18} className="text-blue-600" />
            </div>
            <div>
              <p className="text-slate-800 font-semibold text-sm">가상 고객</p>
              <p className="text-slate-400 text-xs">{personality} · {form.product}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <TtsButton enabled={ttsEnabled} onToggle={toggleTts} />
            <button onClick={handleFeedback} className="bg-amber-500 hover:bg-amber-400 text-white text-sm font-bold px-4 py-2 rounded-lg transition-colors shadow-sm">
              피드백
            </button>
          </div>
        </div>
      </div>

      {/* 대화창 */}
      <div className="flex-1 overflow-y-auto max-w-2xl w-full mx-auto px-4 py-4 space-y-3">
        {messages.map((m, i) => (
          <Bubble key={i} m={m} personality={personality} profile={form.profile} />
        ))}
        {loading && <ThinkingBubble color="blue" />}
        {error && <p className="text-red-500 text-xs text-center">{error}</p>}
        <div ref={messagesEndRef} />
      </div>

      {/* 입력창 */}
      <div className="bg-white border-t border-slate-200 px-4 py-3 max-w-2xl w-full mx-auto">
        <div className="flex gap-2">
          <MicButton isListening={isListening} onClick={toggleMic} />
          <input
            className="flex-1 border border-slate-300 rounded-xl px-4 py-3 text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all text-sm"
            placeholder={isListening ? '🎤 말씀하세요...' : '메시지를 입력하거나 마이크를 누르세요'}
            value={isListening ? liveText : input}
            onChange={e => { if (!isListening) setInput(e.target.value); }}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
          />
          <SendButton onClick={() => sendMessage()} disabled={loading || !(isListening ? liveText : input).trim()} color="blue" />
        </div>
      </div>

      <FeedbackModal
        show={showFeedback}
        onClose={() => setShowFeedback(false)}
        loading={feedbackLoading}
        feedback={feedback}
        title="대화 피드백"
      />
    </div>
  );
}

// ── 공통 UI 조각 ──────────────────────────────────────────
const INPUT = 'w-full border border-slate-300 rounded-xl px-4 py-3 text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all';
const TEXTAREA = `${INPUT} resize-none`;
const SELECT = 'w-full border border-slate-300 rounded-xl px-4 py-3 text-slate-800 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all bg-white';

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-slate-700 text-sm font-semibold mb-2">{label}</label>
      {children}
    </div>
  );
}

function Bubble({ m, personality, profile }) {
  const isUser = m.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center mr-2 flex-shrink-0 mt-1">
          <Bot size={15} className="text-blue-600" />
        </div>
      )}
      <div className={`max-w-[75%] px-4 py-3 rounded-2xl text-sm leading-relaxed shadow-sm ${
        isUser ? 'bg-blue-500 text-white rounded-br-sm' : 'bg-white text-slate-700 rounded-bl-sm border border-slate-200'
      }`}>
        {m.text}
        {!isUser && (
          <button onClick={() => speak(m.text, personality, profile)} className="mt-1.5 flex items-center gap-1 text-xs text-blue-400 hover:text-blue-600 transition-colors">
            <Volume2 size={12} /><span>다시 듣기</span>
          </button>
        )}
      </div>
      {isUser && (
        <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center ml-2 flex-shrink-0 mt-1">
          <User size={15} className="text-white" />
        </div>
      )}
    </div>
  );
}

function ThinkingBubble({ color = 'blue' }) {
  const bg = color === 'blue' ? 'bg-blue-100' : 'bg-emerald-100';
  const icon = color === 'blue' ? 'text-blue-600' : 'text-emerald-600';
  return (
    <div className="flex justify-start">
      <div className={`w-8 h-8 rounded-full ${bg} flex items-center justify-center mr-2`}>
        <Bot size={15} className={icon} />
      </div>
      <div className="bg-white border border-slate-200 px-4 py-3 rounded-2xl rounded-bl-sm shadow-sm flex items-center gap-1.5">
        {[0, 1, 2].map(i => (
          <span key={i} className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
        ))}
      </div>
    </div>
  );
}

export function MicButton({ isListening, onClick }) {
  return (
    <button onClick={onClick} className={`flex-shrink-0 p-3 rounded-xl transition-colors ${isListening ? 'bg-red-500 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
      {isListening ? <Mic size={20} /> : <MicOff size={20} />}
    </button>
  );
}

export function SendButton({ onClick, disabled, color = 'blue' }) {
  const bg = color === 'blue' ? 'bg-blue-500 hover:bg-blue-400' : 'bg-emerald-500 hover:bg-emerald-400';
  return (
    <button onClick={onClick} disabled={disabled} className={`${bg} disabled:bg-slate-200 disabled:text-slate-400 text-white p-3 rounded-xl transition-colors`}>
      <Send size={18} />
    </button>
  );
}

export function TtsButton({ enabled, onToggle }) {
  return (
    <button onClick={onToggle} className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${enabled ? 'bg-blue-500 text-white shadow-sm' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
      {enabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
      <span>{enabled ? '음성 ON' : '음성 OFF'}</span>
    </button>
  );
}

export { Bubble, ThinkingBubble };
