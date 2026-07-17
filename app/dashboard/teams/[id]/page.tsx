import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export default async function TeamPage({ params }: { params: { id: string } }) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { data: team } = await supabase
    .from('teams')
    .select('id, name, description, created_at')
    .eq('id', params.id)
    .single();

  if (!team) {
    notFound();
  }

  const { data: members } = await supabase
    .from('team_members')
    .select('role, joined_at, users(display_name, email)')
    .eq('team_id', params.id)
    .order('joined_at', { ascending: true });

  return (
    <main className="min-h-screen p-8 max-w-2xl mx-auto flex flex-col gap-8">
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1 text-sm text-gray-600 border rounded-lg px-3 py-2 w-fit hover:bg-gray-50 active:bg-gray-100"
      >
        ← 대시보드로
      </Link>

      <header>
        <h1 className="text-2xl font-bold">{team.name}</h1>
        {team.description && <p className="text-sm text-gray-500 mt-1">{team.description}</p>}
      </header>

      <section>
        <h2 className="text-lg font-semibold mb-3">멤버</h2>
        <ul className="flex flex-col gap-2">
          {(members ?? []).map((member, i) => {
            const profile = member.users as unknown as { display_name: string | null; email: string } | null;
            return (
              <li key={i} className="border rounded px-4 py-3 flex justify-between">
                <span>{profile?.display_name || profile?.email}</span>
                <span className="text-xs text-gray-500">{member.role}</span>
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
