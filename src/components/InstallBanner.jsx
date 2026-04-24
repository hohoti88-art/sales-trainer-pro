import { useState, useEffect } from 'react';

export default function InstallBanner() {
  const [prompt, setPrompt] = useState(null);
  const [show, setShow] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem('install-dismissed')) return;

    const handler = (e) => {
      e.preventDefault();
      setPrompt(e);
      setShow(true);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  // iOS Safari: 이미 설치됐으면 숨김
  useEffect(() => {
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setShow(false);
    }
  }, []);

  if (!show || dismissed) return null;

  async function handleInstall() {
    if (!prompt) return;
    prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === 'accepted') {
      setShow(false);
    }
    setDismissed(true);
    sessionStorage.setItem('install-dismissed', '1');
  }

  function handleDismiss() {
    setShow(false);
    setDismissed(true);
    sessionStorage.setItem('install-dismissed', '1');
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 p-4">
      <div className="bg-slate-800 border border-slate-600 rounded-2xl p-4 flex items-center gap-3 shadow-2xl">
        <img src="/icon-192.png" alt="앱 아이콘" className="w-12 h-12 rounded-xl flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-white text-sm font-bold leading-tight">홈 화면에 추가</p>
          <p className="text-slate-400 text-xs mt-0.5 leading-tight">앱처럼 바로 실행 · 음성 기능 안정적</p>
        </div>
        <button
          onClick={handleDismiss}
          className="text-slate-500 text-lg px-1 flex-shrink-0"
          aria-label="닫기"
        >✕</button>
        <button
          onClick={handleInstall}
          className="bg-amber-500 text-slate-900 text-sm font-bold px-4 py-2 rounded-xl flex-shrink-0"
        >
          추가
        </button>
      </div>
    </div>
  );
}
