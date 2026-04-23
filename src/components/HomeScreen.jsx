import { useNavigate } from 'react-router-dom';
import { MessageCircle, Phone, TrendingUp, Users } from 'lucide-react';

const menuItems = [
  {
    icon: <MessageCircle size={36} className="text-blue-500" />,
    title: '세일즈 화법 연습',
    subtitle: 'AI 고객과 실시간 대화로 화법을 개발하세요',
    path: '/speech',
    accent: 'border-blue-200 hover:border-blue-400',
    iconBg: 'bg-blue-50',
  },
  {
    icon: <Phone size={36} className="text-emerald-500" />,
    title: '세일즈 전화 연습',
    subtitle: 'TA 스크립트 생성 후 전화 영업을 연습하세요',
    path: '/call',
    accent: 'border-emerald-200 hover:border-emerald-400',
    iconBg: 'bg-emerald-50',
  },
  {
    icon: <TrendingUp size={36} className="text-purple-500" />,
    title: '업셀링 & 크로스셀링',
    subtitle: '기존 고객에게 더 많이 파는 전략을 수립하세요',
    path: '/upsell',
    accent: 'border-purple-200 hover:border-purple-400',
    iconBg: 'bg-purple-50',
  },
  {
    icon: <Users size={36} className="text-amber-500" />,
    title: '고객 확대하기',
    subtitle: '새로운 고객층과 판매 채널을 발굴하세요',
    path: '/expand',
    accent: 'border-amber-200 hover:border-amber-400',
    iconBg: 'bg-amber-50',
  },
];

export default function HomeScreen() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-slate-800 px-4 py-8 text-center">
        <div className="inline-block bg-amber-400/20 border border-amber-400/40 rounded-full px-3 py-1 mb-3">
          <span className="text-amber-300 text-xs font-medium">AI 기반 세일즈 트레이닝</span>
        </div>
        <h1 className="text-3xl font-bold text-white mb-1.5">
          Sales Trainer <span className="text-amber-400">Pro</span>
        </h1>
        <p className="text-slate-400 text-sm">AI와 함께 세일즈 실력을 한 단계 끌어올리세요</p>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6">
        <div className="grid grid-cols-1 gap-3">
          {menuItems.map((item) => (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={`bg-white border-2 ${item.accent} rounded-2xl p-5 text-left
                active:scale-[0.98] transition-all duration-150 shadow-sm cursor-pointer flex items-center gap-4`}
            >
              <div className={`w-12 h-12 ${item.iconBg} rounded-xl flex items-center justify-center flex-shrink-0`}>
                {item.icon}
              </div>
              <div>
                <h2 className="text-slate-800 font-bold text-base mb-0.5">{item.title}</h2>
                <p className="text-slate-500 text-sm leading-snug">{item.subtitle}</p>
              </div>
            </button>
          ))}
        </div>

        <p className="text-center text-slate-400 text-xs mt-6">
          Powered by Google Gemini AI
        </p>
      </div>
    </div>
  );
}
