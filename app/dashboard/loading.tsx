export default function DashboardLoading() {
  return (
    <main className="min-h-screen bg-background p-4 md:p-6" aria-busy="true" aria-label="불러오는 중">
      <div className="max-w-6xl w-full mx-auto flex flex-col gap-4 animate-pulse">
        <div className="h-8 w-48 rounded bg-surface-hover" />
        <div className="h-96 rounded-lg bg-surface border border-border" />
      </div>
    </main>
  );
}
