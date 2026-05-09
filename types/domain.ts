export const APP_STATUS = {
  pending: "Pendente",
  inProgress: "Andamento",
  done: "Concluida",
} as const;

export const APP_STATUSES = [
  APP_STATUS.pending,
  APP_STATUS.inProgress,
  APP_STATUS.done,
] as const;

export type AppStatus = (typeof APP_STATUSES)[number];

export type OperationKey = {
  ordem: string;
  operacao: string;
  suboperacao: string;
};

export type OperationRecord = OperationKey & {
  rowNumber: number;
  campoSelecao: string;
  centroTrabalho: string;
  descricao: string;
  texto: string;
  quenteFrio: string;
  apoio: string;
  ptColorida: string;
  statusSistema: string;
  statusUsuario: string;
  trabalho: number;
  trabalhoReal: number;
  duracaoNormal: number;
  fimExecucao: string;
  restrInicio: string;
  restricInicio: string;
  faseParada: string;
  criterioFase: string;
  statusApp: AppStatus;
  observacaoApp: string;
  atualizadoEm: string;
  atualizadoPor: string;
  atualizadoPorId: string;
  versaoApp: string;
};

export type AttachmentRecord = {
  id: string;
  ordem: string;
  originalFileName: string;
  relativePath: string;
  contentType: string;
  size: number;
  createdAt: string;
  createdBy: string;
  createdById: string;
  deletedAt: string;
  deletedBy: string;
  deletedById: string;
  appVersion: string;
  isDeleted: boolean;
};

export type ProgressBreakdown = {
  totalWeight: number;
  pendingWeight: number;
  inProgressWeight: number;
  doneWeight: number;
  pendingPercent: number;
  inProgressPercent: number;
  donePercent: number;
};

export type OrderSummary = {
  ordem: string;
  operations: OperationRecord[];
  attachments: AttachmentRecord[];
  progress: ProgressBreakdown;
  taskCount: number;
  totalWork: number;
  doneWork: number;
  campoSelecao: string;
  phaseLabel: string;
  centersLabel: string;
  leadDescription: string;
};

export type PhaseSummary = {
  phase: string;
  taskCount: number;
  orderCount: number;
  centerCount: number;
  totalWork: number;
  progress: ProgressBreakdown;
};

export type WorkbookSnapshot = {
  operations: OperationRecord[];
  orders: OrderSummary[];
  attachments: AttachmentRecord[];
  phaseSummaries: Record<string, PhaseSummary>;
  loadedAt: string;
};

export type ExcelOperationRow = {
  "Ordem": string | number | null;
  "Operação": string | number | null;
  "Suboperação": string | number | null;
  "Campo seleção": string | null;
  "Centro trabalho": string | null;
  "TxtDesc.Oper.": string | null;
  "TEXTO": string | null;
  "QUENTE/FRIO": string | null;
  "APOIO": string | null;
  "VERMELHA     AMARELA    BRANCA": string | null;
  "Status sistema": string | null;
  "Status usuário": string | null;
  "Trabalho": string | number | null;
  "Trabalho real": string | number | null;
  "Duração normal": string | number | null;
  "Fim execução": string | number | null;
  "Restr.início": string | number | null;
  "Restriç.início": string | number | null;
  "Fase parada": string | null;
  "Critério fase": string | null;
  "Status app": string | null;
  "Observação app": string | null;
  "Atualizado em": string | null;
  "Atualizado por": string | null;
  "Atualizado por id": string | null;
  "Versão app": string | null;
  row_number?: number | null;
};

export type ExcelAttachmentRow = {
  "Id": string | null;
  "Ordem": string | number | null;
  "Nome arquivo": string | null;
  "Caminho relativo": string | null;
  "Tipo": string | null;
  "Tamanho": string | number | null;
  "Criado em": string | null;
  "Excluído em": string | null;
  "Criado por": string | null;
  "Criado por id": string | null;
  "Excluído por": string | null;
  "Excluído por id": string | null;
  "Versão app": string | null;
};

export type StatusUpdatePayload = {
  key: OperationKey;
  status: AppStatus;
  observation: string;
};
