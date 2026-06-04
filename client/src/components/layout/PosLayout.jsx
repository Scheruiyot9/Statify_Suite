import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useAuthStore } from '@/app/store';
import useInactivityLock from '@/hooks/useInactivityLock';

export default function PosLayout({ children }) {
  useInactivityLock(); // starts / stops the inactivity timer for the POS terminal

  const user = useAuthStore((s) => s.user);

  return (
    <div className="flex h-screen flex-col bg-gray-100">
      {/* Slim POS header */}
      <header
        className="relative flex items-center justify-between px-4 py-2 text-white"
        style={{ background: 'linear-gradient(90deg, #011920 0%, #01303d 50%, #024A59 100%)' }}
      >
        <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-secondary-500/60 to-transparent" />
        <div className="flex items-center gap-3">
          <Link
            to="/app/dashboard"
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-white/70 hover:bg-white/10 hover:text-white transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </Link>
          <img src="/statify-icon-white.svg" alt="Statify" className="h-7 w-7" />
        </div>
        <p className="text-xs text-white/70">
          {user?.firstName} {user?.lastName} · <span className="capitalize">{user?.role?.replace('_', ' ')}</span>
        </p>
      </header>

      {/* Full-height POS content */}
      <div className="flex-1 overflow-hidden">{children}</div>
    </div>
  );
}
