import { BrowserRouter, Routes, Route } from 'react-router-dom';
import HomeScreen from './components/HomeScreen';
import SpeechPractice from './components/menu1/SpeechPractice';
import CallPractice from './components/menu2/CallPractice';
import UpsellStrategy from './components/menu3/UpsellStrategy';
import CustomerExpand from './components/menu4/CustomerExpand';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomeScreen />} />
        <Route path="/speech" element={<SpeechPractice />} />
        <Route path="/call" element={<CallPractice />} />
        <Route path="/upsell" element={<UpsellStrategy />} />
        <Route path="/expand" element={<CustomerExpand />} />
      </Routes>
    </BrowserRouter>
  );
}
