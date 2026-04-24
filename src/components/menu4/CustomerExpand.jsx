import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Home, ChevronLeft, ChevronRight } from 'lucide-react';
import NavBar from '../NavBar';
import { generateCustomerExpansion } from '../../services/geminiService';

const PAGES = [
  { id: 'customerExpansion', emoji: '👥', label: '고객층 확대',       step: '1 / 4', color: 'blue' },
  { id: 'productChange',     emoji: '📦', label: '상품 변화 아이디어', step: '2 / 4', color: 'purple' },
  { id: 'salesMethod',       emoji: '🔀', label: '판매 방법 변화',     step: '3 / 4', color: 'emerald' },
  { id: 'realCases',         emoji: '🏆', label: '실제 세일즈 사례',   step: '4 / 4', color: 'amber' },
];

const ACCENT = {
  blue:    { bg: 'bg-blue-50',    border: 'border-blue-200',    header: 'bg-blue-500',    tag: 'bg-blue-100 text-blue-700',       bar: 'bg-blue-500',    card: 'border-blue-200',    sub: 'text-blue-600'    },
  purple:  { bg: 'bg-purple-50',  border: 'border-purple-200',  header: 'bg-purple-500',  tag: 'bg-purple-100 text-purple-700',   bar: 'bg-purple-500',  card: 'border-purple-200',  sub: 'text-purple-600'  },
  emerald: { bg: 'bg-emerald-50', border: 'border-emerald-200', header: 'bg-emerald-500', tag: 'bg-emerald-100 text-emerald-700', bar: 'bg-emerald-500', card: 'border-emerald-200', sub: 'text-emerald-600' },
  amber:   { bg: 'bg-amber-50',   border: 'border-amber-200',   header: 'bg-amber-500',   tag: 'bg-amber-100 text-amber-700',     bar: 'bg-amber-500',   card: 'border-amber-200',   sub: 'text-amber-600'   },
};

export default function CustomerExpand() {
  const navigate = useNavigate();
  const [step, setStep] = useState('form');
  const [pageIndex, setPageIndex] = useState(0);
  const [product, setProduct] = useState('');
  const [channelsText, setChannelsText] = useState('');
  const [currentCustomers, setCurrentCustomers] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleAnalyze() {
    if (!product.trim() || !currentCustomers.trim() || !channelsText.trim()) {
      setError('상품명, 현재 판매 채널, 현재 주요 고객을 모두 입력해주세요.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = await generateCustomerExpansion(product, currentCustomers, channelsText);
      setResult(data);
      setPageIndex(0);
      setStep('result');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  if (step === 'result' && result) {
    const page = PAGES[pageIndex];
    const a = ACCENT[page.color];
    const isLast = pageIndex === PAGES.length - 1;

    return (
      <div className="min-h-screen bg-slate-50 flex flex-col">
        <NavBar title="고객 확대하기" />

        <div className="max-w-2xl mx-auto w-full px-4 pt-5 pb-4 flex-1 flex flex-col">
          {/* 헤더 */}
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-xs text-slate-400 font-medium">{product}</p>
              <h2 className="text-lg font-bold text-slate-800 mt-0.5">
                {page.emoji} {page.label}
              </h2>
            </div>
            <span className="text-xs text-slate-400 font-medium bg-white border border-slate-200 px-3 py-1 rounded-full">
              {page.step}
            </span>
          </div>

          {/* 진행 바 */}
          <div className="flex gap-1.5 mb-5">
            {PAGES.map((_, i) => (
              <div key={i} className={`h-1.5 flex-1 rounded-full transition-colors ${i <= pageIndex ? a.bar : 'bg-slate-200'}`} />
            ))}
          </div>

          {/* 페이지 콘텐츠 */}
          <div className="flex-1 overflow-y-auto space-y-3">
            {page.id === 'customerExpansion' && <PageCustomerExpansion data={result.customerExpansion} a={a} />}
            {page.id === 'productChange'     && <PageProductChange data={result.productChange} a={a} />}
            {page.id === 'salesMethod'       && <PageSalesMethod data={result.salesMethod} a={a} />}
            {page.id === 'realCases'         && <PageRealCases data={result.salesMethod} a={a} />}
          </div>
        </div>

        {/* 하단 네비게이션 */}
        <div className="bg-white border-t border-slate-200 px-4 py-3">
          <div className="max-w-2xl mx-auto flex items-center gap-2">
            <button
              onClick={() => navigate('/')}
              className="flex items-center gap-1.5 px-4 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 text-sm font-medium transition-colors"
            >
              <Home size={16} /> 홈
            </button>
            <button
              onClick={() => pageIndex === 0 ? setStep('form') : setPageIndex(p => p - 1)}
              className="flex items-center gap-1.5 px-4 py-3 rounded-xl bg-white border border-slate-300 hover:bg-slate-50 text-slate-600 text-sm font-medium transition-colors"
            >
              <ChevronLeft size={16} /> 이전
            </button>
            {isLast ? (
              <button
                onClick={() => setStep('form')}
                className="flex-1 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-white font-bold text-sm transition-colors"
              >
                다시 분석하기
              </button>
            ) : (
              <button
                onClick={() => setPageIndex(p => p + 1)}
                className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-white font-bold text-sm transition-colors"
              >
                다음 단계 <ChevronRight size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <NavBar title="고객 확대하기" />
      <div className="max-w-2xl mx-auto px-4 py-8">
        <h2 className="text-2xl font-bold text-slate-800 mb-1">고객 확대 전략 분석</h2>
        <p className="text-slate-500 text-sm mb-6">현재 고객층과 채널을 분석해 확장 전략을 제안합니다</p>

        {error && (
          <div className="bg-red-50 border border-red-300 text-red-700 px-4 py-3 rounded-xl mb-4 text-sm">{error}</div>
        )}

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-5">
          <div>
            <label className="block text-slate-700 text-sm font-semibold mb-2">현재 판매 상품</label>
            <input
              className="w-full border border-slate-300 rounded-xl px-4 py-3 text-slate-800 placeholder-slate-400 focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition-all"
              placeholder="예: 수제 천연 비누"
              value={product}
              onChange={e => setProduct(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-slate-700 text-sm font-semibold mb-2">현재 판매 채널</label>
            <textarea
              rows={3}
              className="w-full border border-slate-300 rounded-xl px-4 py-3 text-slate-800 placeholder-slate-400 focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition-all resize-none"
              placeholder="예) 네이버 스마트스토어 (주력), 인스타그램 DM 판매, 지역 플리마켓 (월 1회)"
              value={channelsText}
              onChange={e => setChannelsText(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-slate-700 text-sm font-semibold mb-2">현재 주요 고객</label>
            <textarea
              rows={3}
              className="w-full border border-slate-300 rounded-xl px-4 py-3 text-slate-800 placeholder-slate-400 focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition-all resize-none"
              placeholder="예) 30~40대 여성, 친환경 관심 주부, 월 소득 400만원 이상, 재구매율 60%"
              value={currentCustomers}
              onChange={e => setCurrentCustomers(e.target.value)}
            />
          </div>
          <button
            onClick={handleAnalyze}
            disabled={loading}
            className="w-full bg-amber-500 hover:bg-amber-400 disabled:bg-slate-200 disabled:text-slate-400 text-white font-bold py-4 rounded-xl transition-colors flex items-center justify-center gap-2 shadow-sm"
          >
            {loading ? <><Loader2 size={20} className="animate-spin" /> 분석 중...</> : '🚀 분석하기'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 페이지 1: 고객층 확대 ──────────────────────────────────
function PageCustomerExpansion({ data, a }) {
  if (!data) return null;
  return (
    <>
      {data.currentProfile && (
        <div className={`bg-white border ${a.card} rounded-xl px-4 py-3`}>
          <p className={`text-xs ${a.sub} font-semibold mb-1.5`}>현재 고객 프로파일 분석</p>
          <p className="text-slate-700 text-sm leading-relaxed">{data.currentProfile}</p>
        </div>
      )}
      {(data.newSegments || []).map((seg, i) => (
        <div key={i} className={`bg-white border ${a.card} rounded-xl p-4`}>
          <div className="flex items-center gap-2 mb-2">
            <span className={`w-5 h-5 rounded-full ${a.header} text-white text-xs flex items-center justify-center font-bold flex-shrink-0`}>
              {i + 1}
            </span>
            <h4 className={`${a.sub} font-bold text-sm`}>{seg.segment}</h4>
          </div>
          <p className="text-slate-500 text-xs mb-2 leading-relaxed">{seg.reason}</p>
          <p className="text-slate-700 text-sm leading-relaxed">{seg.approach}</p>
        </div>
      ))}
    </>
  );
}

// ── 페이지 2: 상품 변화 아이디어 ──────────────────────────
function PageProductChange({ data, a }) {
  if (!data) return null;
  return (
    <>
      {(data.ideas || []).map((idea, i) => (
        <div key={i} className={`bg-white border ${a.card} rounded-xl p-4`}>
          <span className={`inline-block ${a.tag} text-xs px-2.5 py-1 rounded-full mb-2.5 font-semibold`}>
            {idea.type}
          </span>
          <p className="text-slate-800 text-sm font-semibold mb-1.5 leading-snug">{idea.idea}</p>
          <p className="text-slate-500 text-sm leading-relaxed">{idea.benefit}</p>
        </div>
      ))}
    </>
  );
}

// ── 페이지 3: 판매 방법 변화 ──────────────────────────────
function PageSalesMethod({ data, a }) {
  if (!data) return null;
  const strategies = data.channelStrategies || [];
  return (
    <>
      {strategies.length === 0 ? (
        <div className="text-slate-400 text-sm text-center py-8">채널 전환 전략 데이터가 없습니다.</div>
      ) : (
        strategies.map((cs, i) => (
          <div key={i} className={`bg-white border ${a.card} rounded-xl p-4`}>
            {/* 채널 전환 표시 */}
            <div className="flex items-center gap-2 mb-3">
              <span className="bg-red-100 text-red-600 text-xs font-bold px-2.5 py-1 rounded-lg">{cs.from}</span>
              <ChevronRight size={14} className="text-slate-400 flex-shrink-0" />
              <span className={`${a.tag} text-xs font-bold px-2.5 py-1 rounded-lg`}>{cs.to}</span>
            </div>
            {/* 전략 설명: 줄바꿈 없이 펼쳐서 표시 */}
            <p className="text-slate-700 text-sm leading-relaxed">{cs.strategy}</p>
          </div>
        ))
      )}
    </>
  );
}

// ── 페이지 4: 실제 세일즈 사례 ───────────────────────────
function PageRealCases({ data, a }) {
  if (!data) return null;
  const cases = data.realCases || [];
  return (
    <>
      {cases.length === 0 ? (
        <div className="text-slate-400 text-sm text-center py-8">세일즈 사례 데이터가 없습니다.</div>
      ) : (
        cases.map((c, i) => (
          <div key={i} className={`bg-white border ${a.card} rounded-xl p-4`}>
            <div className="flex items-center gap-2 mb-3">
              <span className={`${a.tag} text-xs font-bold px-2 py-0.5 rounded-full`}>세일즈 사례</span>
              <span className={`${a.sub} font-bold text-sm`}>{c.company}</span>
            </div>
            {c.product && (
              <p className="text-slate-400 text-xs mb-3">업종: {c.product}</p>
            )}
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2.5">
                <p className="text-xs text-red-500 font-semibold mb-1">Before</p>
                <p className="text-slate-600 text-xs leading-relaxed">{c.before}</p>
              </div>
              <div className={`${a.bg} border ${a.card} rounded-lg px-3 py-2.5`}>
                <p className={`text-xs ${a.sub} font-semibold mb-1`}>After</p>
                <p className="text-slate-600 text-xs leading-relaxed">{c.after}</p>
              </div>
            </div>
            <div className="bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
              <p className="text-amber-700 text-xs font-medium leading-relaxed">💡 {c.lesson}</p>
            </div>
          </div>
        ))
      )}
    </>
  );
}
