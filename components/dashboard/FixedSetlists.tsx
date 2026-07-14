import Link from 'next/link';
import { Pin } from 'lucide-react';

interface FixedSetlist {
  id: string;
  title: string;
}

export default function FixedSetlists({ setlists }: { setlists: FixedSetlist[] }) {
  if (setlists.length === 0) return null;

  return (
    <section className="mt-6 bg-white border rounded-lg p-4 md:p-6">
      <h2 className="text-sm font-semibold text-gray-500 mb-3">고정 콘티</h2>
      <div className="flex flex-wrap gap-2">
        {setlists.map((setlist) => (
          <Link
            key={setlist.id}
            href={`/dashboard/setlist/${setlist.id}`}
            className="flex items-center gap-2 border rounded-full px-4 py-2 text-sm font-medium hover:bg-gray-50"
          >
            <Pin size={14} />
            {setlist.title}
          </Link>
        ))}
      </div>
    </section>
  );
}
