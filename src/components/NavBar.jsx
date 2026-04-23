import { useNavigate } from 'react-router-dom';
import { Home } from 'lucide-react';

export default function NavBar({ title }) {
  const navigate = useNavigate();

  return (
    <nav className="bg-slate-800 px-4 py-3 flex items-center relative shadow-md">
      <button
        onClick={() => navigate('/')}
        className="flex items-center gap-2 text-amber-400 hover:text-amber-300 transition-colors"
      >
        <Home size={20} />
        <span className="text-sm font-medium">홈</span>
      </button>
      {title && (
        <span className="absolute left-1/2 -translate-x-1/2 text-white font-semibold text-sm">
          {title}
        </span>
      )}
    </nav>
  );
}
