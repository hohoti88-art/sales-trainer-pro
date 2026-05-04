import { useState } from 'react';

const ua = navigator.userAgent;
const isKakaoTalk = /KAKAOTALK/i.test(ua);
const isInAppBrowser = isKakaoTalk || /Instagram|FBAV|FB_IAB|Line|NaverApp|DaumApp/i.test(ua);
const isIOS = /iPhone|iPad|iPod/i.test(ua);

export default function KakaoRedirectBanner() {
  const [copied, setCopied] = useState(false);

  if (!isInAppBrowser) return null;

  const appName = isKakaoTalk ? '카카오톡' : '인앱 브라우저';
  const url = window.location.href;

  const openInChrome = () => {
    const encoded = encodeURIComponent(url);
    window.location.href =
      `intent://${window.location.host}${window.location.pathname}${window.location.search}` +
      `#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encoded};end`;
  };

  const copyUrl = () => {
    navigator.clipboard?.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      const el = document.createElement('input');
      el.value = url;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-slate-900 flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-5">
          <div className="w-16 h-16 rounded-full bg-amber-500/20 flex items-center justify-center">
            <svg className="w-8 h-8 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
          </div>
        </div>

        <h2 className="text-white text-xl font-bold text-center mb-2">
          {appName} 브라우저 감지됨
        </h2>
        <p className="text-slate-300 text-sm text-center mb-6 leading-relaxed">
          마이크 기능을 사용하려면<br />
          <strong className="text-white">Chrome 또는 Safari</strong>로 열어야 합니다.
        </p>

        {!isIOS ? (
          <button
            onClick={openInChrome}
            className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold mb-3 transition-colors"
          >
            Chrome으로 열기
          </button>
        ) : null}

        <button
          onClick={copyUrl}
          className="w-full py-3 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-semibold transition-colors"
        >
          {copied ? '복사됨!' : 'URL 복사하기'}
        </button>

        {copied && (
          <p className="text-slate-400 text-xs text-center mt-3">
            복사된 주소를 Safari 또는 Chrome 주소창에 붙여넣기 하세요.
          </p>
        )}
      </div>
    </div>
  );
}
