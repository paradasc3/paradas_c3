import { DashboardClient } from "@/components/dashboard-client";
import { loadSnapshot } from "@/lib/supabase/data";

export const dynamic = "force-dynamic";

export default async function Home() {
  try {
    const snapshot = await loadSnapshot();
    return <DashboardClient initialSnapshot={snapshot} />;
  } catch (error) {
    return (
      <main className="grid min-h-screen place-items-center bg-[var(--page)] p-6 text-[var(--text)]">
        <section className="grid max-w-xl gap-3 rounded-lg border border-[rgba(212,93,104,0.38)] bg-[rgba(212,93,104,0.13)] p-5 text-[#ffd7dc]">
          <strong>Nao foi possivel acessar o Supabase.</strong>
          <span className="text-sm text-[#efb4bc]">
            {error instanceof Error ? error.message : "Erro desconhecido ao carregar dados."}
          </span>
        </section>
      </main>
    );
  }
}
