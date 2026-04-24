import { BrowserRouter, Routes, Route } from 'react-router-dom';
import HomeScreen from './components/HomeScreen';
import SpeechPractice from './components/menu1/SpeechPractice';
import CallPractice from './components/menu2/CallPractice';
import UpsellStrategy from './components/menu3/UpsellStrategy';
import CustomerExpand from './components/menu4/CustomerExpand';
import KakaoRedirectBanner from './components/KakaoRedirectBanner';
import InstallBanner from './components/InstallBanner';

export default function App() {
  return (
    <BrowserRouter>
      {/* 카카오톡·인앱 브라우저 전체 차단 — 모든 페이지에 적용 */}
      <KakaoRedirectBanner />
      {/* PWA 설치 유도 배너 — Android Chrome에서만 표시 */}
      <InstallBanner />
      <Ro