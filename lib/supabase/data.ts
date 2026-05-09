import { createSupabaseDataClient } from "@/lib/supabase/server";
import { buildSnapshot } from "@/lib/progress";
import { normalizeStatus } from "@/lib/status";
import type {
  AttachmentRecord,
  ExcelAttachmentRow,
  ExcelOperationRow,
  OperationKey,
  OperationRecord,
  StatusUpdatePayload,
  WorkbookSnapshot,
} from "@/types/domain";

const OPERATIONS_TABLE = "parada_u700_operacoes";
const ATTACHMENTS_TABLE = "parada_u700_anexos";

function text(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function number(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number.parseFloat(text(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function mapOperation(row: ExcelOperationRow, index: number): OperationRecord {
  return {
    rowNumber: Number(row.row_number ?? index + 2),
    ordem: text(row["Ordem"]),
    operacao: text(row["Operação"]),
    suboperacao: text(row["Suboperação"]),
    campoSelecao: text(row["Campo seleção"]),
    centroTrabalho: text(row["Centro trabalho"]),
    descricao: text(row["TxtDesc.Oper."]),
    texto: text(row["TEXTO"]),
    quenteFrio: text(row["QUENTE/FRIO"]),
    apoio: text(row["APOIO"]),
    ptColorida: text(row["VERMELHA     AMARELA    BRANCA"]),
    statusSistema: text(row["Status app"]),
    statusUsuario: text(row["Status usuário"]),
    trabalho: number(row["Trabalho"]),
    trabalhoReal: number(row["Trabalho real"]),
    duracaoNormal: number(row["Duração normal"]),
    fimExecucao: text(row["Fim execução"]),
    restrInicio: text(row["Restr.início"]),
    restricInicio: text(row["Restriç.início"]),
    faseParada: text(row["Fase parada"]),
    criterioFase: text(row["Critério fase"]),
    statusApp: normalizeStatus(text(row["Status app"])),
    observacaoApp: text(row["Observação app"]),
    atualizadoEm: text(row["Atualizado em"]),
    atualizadoPor: text(row["Atualizado por"]),
    atualizadoPorId: text(row["Atualizado por id"]),
    versaoApp: text(row["Versão app"]),
  };
}

function mapAttachment(row: ExcelAttachmentRow): AttachmentRecord {
  const deletedAt = text(row["Excluído em"]);

  return {
    id: text(row["Id"]),
    ordem: text(row["Ordem"]),
    originalFileName: text(row["Nome arquivo"]),
    relativePath: text(row["Caminho relativo"]),
    contentType: text(row["Tipo"]),
    size: number(row["Tamanho"]),
    createdAt: text(row["Criado em"]),
    createdBy: text(row["Criado por"]),
    createdById: text(row["Criado por id"]),
    deletedAt,
    deletedBy: text(row["Excluído por"]),
    deletedById: text(row["Excluído por id"]),
    appVersion: text(row["Versão app"]),
    isDeleted: deletedAt.trim().length > 0,
  };
}

export async function loadSnapshot(): Promise<WorkbookSnapshot> {
  const supabase = await createSupabaseDataClient();

  const [{ data: operationRows, error: operationsError }, { data: attachmentRows, error: attachmentsError }] =
    await Promise.all([
      supabase.from(OPERATIONS_TABLE).select("*").order("row_number", { ascending: true }),
      supabase.from(ATTACHMENTS_TABLE).select("*"),
    ]);

  if (operationsError) {
    throw new Error(`Nao foi possivel carregar operacoes no Supabase: ${operationsError.message}`);
  }

  if (attachmentsError) {
    throw new Error(`Nao foi possivel carregar anexos no Supabase: ${attachmentsError.message}`);
  }

  const operations = ((operationRows ?? []) as ExcelOperationRow[])
    .map(mapOperation)
    .filter((operation) => operation.ordem.trim() || operation.operacao.trim());
  const attachments = ((attachmentRows ?? []) as ExcelAttachmentRow[])
    .filter((attachment) => text(attachment["Id"]).trim())
    .map(mapAttachment);

  return buildSnapshot(operations, attachments);
}

export async function updateOperationStatus(payload: StatusUpdatePayload): Promise<void> {
  const supabase = await createSupabaseDataClient();
  const now = new Date().toISOString();
  const key: OperationKey = payload.key;

  const { error } = await supabase
    .from(OPERATIONS_TABLE)
    .update({
      "Status app": normalizeStatus(payload.status),
      "Observação app": payload.observation ?? "",
      "Atualizado em": now,
      "Atualizado por": "App Web",
      "Atualizado por id": "TODO_AUTH_USER",
      "Versão app": "next-web",
    })
    .eq("Ordem", key.ordem)
    .eq("Operação", key.operacao)
    .eq("Suboperação", key.suboperacao);

  if (error) {
    throw new Error(`Nao foi possivel atualizar status no Supabase: ${error.message}`);
  }
}
