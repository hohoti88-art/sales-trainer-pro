import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, TrendingUp, RefreshCw, ArrowUp, Shuffle, FileText, Home, ChevronLeft, ChevronRight } from 'lucide-react';
import NavBar from '../NavBar';
import { generateUpsellStrategy } from '../../services/geminiService';

const INDUSTRIES = ['IT/소프트웨어', '제조업', '도소매업', '서비스업', '건설업', '금융/보험', '의료/헬스케어', '교육', '부동산', '물류/운송', '기타'];

const PAGES = [
  {
    key: 'recurring',
    emoji: '🔄',
    label: '반복 매출 전략',
    step: '1 / 4',
    accent: { bg: 'bg-blue-50', border: 'border-blue-200', header: 'bg-blue-500', tag: 'bg-blue-100 text-blue-700', dot: 'bg-blue-400', script: 'border-blue-100' },
  },
  {
    key: 'upsell',
    emoji: '⬆️',
    label: '업셀링 전략',
    step: '2 / 4',
    accent: { bg: 'bg-purple-50', border: 'border-purple-200', header: 'bg-purple-500', tag: 'bg-purple-100 text-purple-700', dot: 'bg-purple-400', script: 'border-purple-100' },
  },
  {
    key: 'crosssell',
    emoji: '↔️',
    label: '크로스셀링 전략',
    step: '3 / 4',
    accent: { bg: 'bg-emerald-50', border: 'border-emerald-200', header: 'bg-emerald-500', tag: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-400', script: 'border-emerald-100' },
  },
  {
    key: 'renewal',
    emoji: '📋',
    label: '갱신 계약 전략',
    step: '4 / 4',
    accent: { bg: 'bg-amber-50', border: 'border-amber-200', header: 'bg-amber-500', tag: 'bg-amber-100 text-amber-700', dot: 'bg-amber-400', script: 'border-amber-100' },
  },
];

export default function UpsellStrategy() {
  const navigate = useNavigate();
  const [step, setStep] = useState('form');
  const [pageIndex, setPageIndex] = useState(0);
  const [product, setProduct] = useState('');
  const [industry, setIndustry] = useState('IT/소프트웨어');
  const [customersText, setCustomersText] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleGenerate() {
    if (!product.trim() || !customersText.trim()) {
      setError('판매 상품명과 기존 고객 내용을 입력해주세요.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = await generateUpsellStrategy(product, customersText, industry);
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
    const data = result[page.key];
    const { accent } = page;
    const isLast = pageIndex === PAGES.length - 1;

    return (
      <div className="min-h-screen bg-slate-50 flex flex-col">
        <NavBar title="업셀링 & 크로스셀링" />

        <div className="max-w-2xl mx-auto w-full px-4 pt-5 pb-4 flex-1 flex flex-col">
          {/* 진행 표시 */}
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-xs text-slate-400 font-medium">{product} · {industry}</p>
              <h2 className="text-lg font-bold text-slate-800 mt-0.5">
                {page.emoji} {page.label}
              </h2>
            </div>
            <span className="text-xs text-slate-400 font-medium bg-white border border-slate-200 px-3 py-1 rounded-full">
              {page.step}
            </span>
          </div>

          {/* 단계 인디케이터 */}
          <div className="flex gap-1.5 mb-5">
            {PAGES.map((_, i) => (
              <div
                key={i}
                className={`h-1.5 flex-1 rounded-full transition-colors ${i <= pageIndex ? accent.header : 'bg-slate-200'}`}
              />
            ))}
          </div>

          {/* 콘텐츠 */}
          {data ? (
            <div className={`${accent.bg} border ${accent.border} rounded-2xl p-5 flex-1`}>
              <ul className="space-y-3 mb-5">
                {(data.actions || []).map((action, i) => (
                  <li key={i} className="flex items-start gap-3 bg-white/70 rounded-xl px-4 py-3">
                    <span className={`w-5 h-5 rounded-full ${accent.header} text-white text-xs flex items-center justify-center flex-shrink-0 mt-0.5 font-bold`}>
                      {i + 1}
                    </span>
                    <span className="text-slate-700 text-sm leading-relaxed">{action}</span>
                  </li>
                ))}
              </ul>
              {data.script && (
                <div className={`bg-white border ${accent.script} rounded-xl px-4 py-3`}>
                  <p className="text-xs text-slate-400 font-semibold mb-1.5">💬 실전 멘트 예시</p>
                  <p className="text-slate-700 text-sm italic leading-relaxed">"{data.script}"</p>
                </div>
              )}
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">데이터가 없습니다.</div>
          )}
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
                다시 생성하기
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
      <NavBar title="업셀링 & 크로스셀링" />
      <div className="max-w-2xl mx-auto px-4 py-8">
        <h2 className="text-2xl font-bold text-slate-800 mb-1">업셀링 & 크로스셀링 전략</h2>
        <p className="text-slate-500 text-sm mb-6">기존 고객 대상 매출 확대 전략을 AI가 제안합니다</p>

        {error && (
          <div className="bg-red-50 border border-red-300 text-red-700 px-4 py-3 rounded-xl mb-4 text-sm">{error}</div>
        )}

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-5">
          <div>
            <label className="block text-slate-700 text-sm font-semibold mb-2">판매 상품명</label>
            <input
              className="w-full border border-slate-300 rounded-xl px-4 py-3 text-slate-800 placeholder-slate-400 focus:outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-100 transition-all"
              placeholder="예: 클라우드 ERP 시스템"
              value={product}
              onChange={e => setProduct(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-slate-700 text-sm font-semibold mb-2">업종</label>
            <select
              className="w-full border border-slate-300 rounded-xl px-4 py-3 text-slate-800 focus:outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-100 transition-all bg-white"
              value={industry}
              onChange={e => setIndustry(e.target.value)}
            >
              {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-slate-700 text-sm font-semibold mb-2">기존 고객</label>
            <textarea
              rows={5}
              className="w-full border border-slate-300 rounded-xl px-4 py-3 text-slate-800 placeholder-slate-400 focus:outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-100 transition-all resize-none"
              placeholder={`현재 거래 중인 고객을 자유롭게 입력하세요.\n\n예시)\n• 삼성전자 — IT인프라 유지보수 계약 (연 2억)\n• 현대자동차 부품협력사 5곳 — 소규모 라이선스\n• 중소제조업체 30곳 — 월 구독형 서비스 이용 중`}
              value={customersText}
              onChange={e => setCustomersText(e.target.value)}
            />
          </div>

          <button
            onClick={handleGenerate}
            disabled={loading}
            className="w-full bg-amber-500 hover:bg-amber-400 disabled:bg-slate-200 disabled:text-slate-400 text-white font-bold py-4 rounded-xl transition-colors flex items-center justify-center gap-2 shadow-sm"
          >
            {loading ? (
              <><Loader2 size={20} className="animate-spin" /> 전략 생성 중...</>
            ) : (
              <><TrendingUp size={20} /> 전략 생성</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
