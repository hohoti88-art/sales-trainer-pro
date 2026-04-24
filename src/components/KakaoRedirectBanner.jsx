const ua = navigator.userAgent;
const isKakaoTalk = /KAKAOTALK/i.test(ua);
const isInAppBrowser = isKakaoTalk || /Instagram|FBAV|FB_IAB|Line|NaverApp|DaumApp/i.test(ua);
const isIOS = /iPhone|iPad|iPod/i.test(ua);

export default function KakaoRedirectBanner() {
  if (!isInAppBrowser) return null;

  const appName = isKakaoTalk ? '카카오톡' : '인앱';
  const targetBrowser = isIOS ? 'Safari' : 'Chrome';

  const openInBrowser = () => {
    const url = window.location.href;
    if (!isIOS) {
      // Android: Chrome intent URL
      const encoded = encodeURIComponent(url);
      window.location.href = `intent://${window.location.host}${window.location.pathname}${window.location.search}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encoded};end`;
    } else {
      // iOS: clipboard copy + alert (카카오톡 내에서 Safari 열기 불가)
      navigator.clipboard?.writeText(url).catch(() => {});
      alert(`주소창에 붙여넣기 하거나 Safari를 열고 접속해 주세요:\n${url}`);
    }
  };

  return (
    <div className="bg-amber-50 border-b-2 border-amber-300 px-4 py-3">
      <p className="text-amber-900 text-xs font-semibold mb-1">
        ⚠️ {appName} 브라우저 — 마이크·음성 기능 제한됨
      </p>
      <p className="text-amber-700 text-xs mb-2 leading-snug">
        음성 연습을 제대로 하려면 <strong>{targetBrowser}</strong>에서 열어야 합니다.
      </p>
      <button
        onClick={openInBrowser}
        className="w-full bg-amber-500 active:bg-amber-600 text-white text-sm font-bold py-2.5 rounded-xl shadow-sm"
      >
        {targetBrowser}으로 열기 →
      </button>
    </div>
  );
}
