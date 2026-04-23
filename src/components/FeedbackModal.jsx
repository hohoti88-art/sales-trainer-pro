import { X, Loader2 } from 'lucide-react';

const SCORE_COLOR = (s) =>
  s >= 80 ? 'text-emerald-600 bg-emerald-50 border-emerald-200'
  : s >= 60 ? 'text-amber-600 bg-amber-50 border-amber-200'
  : 'text-red-500 bg-red-50 border-red-200';

const SCORE_RING = (s) =>
  s >= 80 ? 'stroke-emerald-500' : s >= 60 ? 'stroke-amber-500' : 'stroke-red-400';

function ScoreCircle({ score }) {
  const r = 30;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  return (
    <div className="flex flex-col items-center gap-1">
      <svg width="80" height="80" viewBox="0 0 80 80" className="-rotate-90">
        <circle cx="40" cy="40" r={r} fill="none" stroke="#e2e8f0" strokeWidth="7" />
        <circle
          cx="40" cy="40" r={r} fill="none" strokeWidth="7"
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
          className={`transition-all duration-700 ${SCORE_RING(score)}`}
        />
      </svg>
      <span className="text-2xl font-black -mt-[68px] mb-[44px] text-slate-800">{score}</span>
    </div>
  );
}

export default function FeedbackModal({ show, onClose, loading, feedback, title = '피드백' }) {
  if (!show) return null;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto border border-slate-200">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 sticky top-0 bg-white z-10">
          <h3 className="text-slate-800 font-bold text-base">📊 {title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="px-5 pb-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-14 gap-3 text-slate-400">
              <Loader2 size={28} className="animate-spin" />
              <span className="text-sm">분석 중...</span>
            </div>
          ) : feedback ? (
            <div className="space-y-4 pt-4">
              {/* 점수 + 요약 */}
              <div className="flex items-center gap-4 bg-slate-50 rounded-2xl px-4 py-3 border border-slate-200">
                <ScoreCircle score={feedback.score} />
                <div>
                  <p className="text-xs text-slate-400 font-semibold uppercase tracking-wide mb-1">총점</p>
                  <p className={`text-sm font-bold px-2 py-0.5 rounded-lg border inline-block ${SCORE_COLOR(feedback.score)}`}>
                    {feedback.score >= 80 ? '우수' : feedback.score >= 60 ? '양호' : '보완 필요'}
                  </p>
                  {feedback.summary && (
                    <p className="text-slate-600 text-sm mt-1.5 leading-snug">{feedback.summary}</p>
                  )}
                </div>
              </div>

              {/* 잘한 점 */}
              <FeedbackCard
                emoji="✅"
                title="잘한 점"
                items={feedback.good}
                dotColor="bg-emerald-400"
                bg="bg-emerald-50"
                border="border-emerald-100"
                titleColor="text-emerald-700"
              />

              {/* 개선할 점 */}
              <FeedbackCard
                emoji="🔧"
                title="개선할 점"
                items={feedback.improve}
                dotColor="bg-amber-400"
                bg="bg-amber-50"
                border="border-amber-100"
                titleColor="text-amber-700"
              />

              {/* 추천 화법 */}
              <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4">
                <p className="text-blue-700 font-bold text-sm mb-3">💬 추천 화법</p>
                <div className="space-y-2.5">
                  {(feedback.scripts || []).map((s, i) => {
                    const parts = s.split(/→\s*멘트:\s*/);
                    const situation = parts[0]?.replace(/^상황:\s*/,'').trim();
                    const script = parts[1]?.trim();
                    return (
                      <div key={i} className="bg-white border border-blue-100 rounded-xl px-3 py-2.5">
                        {situation && <p className="text-blue-500 text-xs font-semibold mb-1">{situation}</p>}
                        <p className="text-slate-700 text-sm italic">"{script || s}"</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function FeedbackCard({ emoji, title, items, dotColor, bg, border, titleColor }) {
  return (
    <div className={`${bg} border ${border} rounded-2xl p-4`}>
      <p className={`${titleColor} font-bold text-sm mb-2.5`}>{emoji} {title}</p>
      <ul className="space-y-2">
        {(items || []).map((item, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className={`w-1.5 h-1.5 rounded-full ${dotColor} mt-1.5 flex-shrink-0`} />
            <span className="text-slate-700 text-sm leading-snug">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
