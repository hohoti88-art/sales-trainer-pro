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
      // fallback: select all in a hidden input
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

  // 전체 화면 차단 — 인앱 브라우저에서는 마이크 권한이 매번 초기화되므로
  // 앱 사용 자체를 차단하고 외부 브라우저로 유도
  return (
    <div className="fixed inset-0 z-[9999] bg-slate-900 flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        {/* 아이콘 */}
        <div className="flex justify-center mb-5">
        