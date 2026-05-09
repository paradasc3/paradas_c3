import { loadSnapshot } from "@/lib/supabase/data";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const snapshot = await loadSnapshot();
    return Response.json(snapshot);
  } catch (error) {
    return Response.json(
      { message: error instanceof Error ? error.message : "Erro desconhecido ao carregar dados." },
      { status: 500 },
    );
  }
}
