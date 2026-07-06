import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { ShiftDetail } from './ShiftsPage';

export default function ShiftDetailPage() {
  const { sessionId } = useParams();
  const navigate = useNavigate();

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/app/shifts')}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors cursor-pointer">
          <ArrowLeft className="h-4 w-4" /> Shifts
        </button>
      </div>

      <div className="rounded-xl border border-gray-100 bg-white shadow-sm p-5">
        <ShiftDetail sessionId={sessionId} />
      </div>
    </div>
  );
}
