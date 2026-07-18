import { Music } from 'lucide-react';

export default function AuthBrandHeader() {
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <div className="w-12 h-12 rounded-full bg-black text-white flex items-center justify-center">
        <Music size={22} />
      </div>
      <h1 className="text-2xl font-bold tracking-tight">Band Setlist</h1>
      <p className="text-sm text-gray-500">팀의 악보와 콘티를 한 곳에서 관리하세요</p>
    </div>
  );
}
