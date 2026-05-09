import { updateOperationStatus } from "@/lib/supabase/data";
import { APP_STATUSES, type StatusUpdatePayload } from "@/types/domain";

export const dynamic = "force-dynamic";

function isStatusUpdatePayload(value: unknown): value is StatusUpdatePayload {
  const payload = value as StatusUpdatePayload;
  return (
    typeof payload === "object" &&
    payload !== null &&
    typeof payload.key?.ordem === "string" &&
    typeof payload.key?.operacao === "string" &&
    typeof payload.key?.suboperacao === "string" &&
    typeof payload.observation === "string" &&
    APP_STATUSES.includes(payload.status)
  );
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!isStatusUpdatePayload(body)) {
      return Response.json({ message: "Payload de atualizacao invalido." }, { status: 400 });
    }

    await updateOperationStatus(body);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { message: error instanceof Error ? error.message : "Erro desconhecido ao atualizar status." },
      { status: 500 },
    );
  }
}
