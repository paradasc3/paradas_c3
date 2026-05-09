import { APP_STATUS, type AttachmentRecord, type OperationRecord, type OrderSummary, type ProgressBreakdown, type WorkbookSnapshot } from "@/types/domain";
import { normalizeStatus } from "@/lib/status";

function roundPercent(value: number): number {
  return Math.round(value * 10) / 10;
}

export function operationWeight(operation: OperationRecord): number {
  return operation.trabalho > 0 ? operation.trabalho : 1;
}

export function calculateProgress(operations: Iterable<OperationRecord>): ProgressBreakdown {
  let totalWeight = 0;
  let pendingWeight = 0;
  let inProgressWeight = 0;
  let doneWeight = 0;

  for (const operation of operations) {
    const weight = operationWeight(operation);
    totalWeight += weight;

    switch (normalizeStatus(operation.statusApp)) {
      case APP_STATUS.done:
        doneWeight += weight;
        break;
      case APP_STATUS.inProgress:
        inProgressWeight += weight;
        break;
      default:
        pendingWeight += weight;
        break;
    }
  }

  const percent = (value: number) => (totalWeight <= 0 ? 0 : roundPercent((value / totalWeight) * 100));

  return {
    totalWeight,
    pendingWeight,
    inProgressWeight,
    doneWeight,
    pendingPercent: percent(pendingWeight),
    inProgressPercent: percent(inProgressWeight),
    donePercent: percent(doneWeight),
  };
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim()))].sort((a, b) =>
    a.localeCompare(b, "pt-BR", { sensitivity: "base" }),
  );
}

export function buildSnapshot(operations: OperationRecord[], attachments: AttachmentRecord[]): WorkbookSnapshot {
  const activeAttachments = attachments.filter((attachment) => !attachment.isDeleted);
  const operationsByOrder = new Map<string, OperationRecord[]>();

  for (const operation of operations) {
    const list = operationsByOrder.get(operation.ordem) ?? [];
    list.push(operation);
    operationsByOrder.set(operation.ordem, list);
  }

  const orders: OrderSummary[] = [...operationsByOrder.entries()]
    .map(([ordem, items]) => {
      const orderedOperations = [...items].sort((a, b) => a.rowNumber - b.rowNumber);
      const progress = calculateProgress(orderedOperations);
      const orderAttachments = activeAttachments.filter((attachment) => attachment.ordem === ordem);

      return {
        ordem,
        operations: orderedOperations,
        attachments: orderAttachments,
        progress,
        taskCount: orderedOperations.length,
        totalWork: orderedOperations.reduce((sum, operation) => sum + operation.trabalho, 0),
        doneWork: orderedOperations
          .filter((operation) => normalizeStatus(operation.statusApp) === APP_STATUS.done)
          .reduce((sum, operation) => sum + operationWeight(operation), 0),
        campoSelecao: orderedOperations.find((operation) => operation.campoSelecao.trim())?.campoSelecao ?? "",
        phaseLabel: uniqueSorted(orderedOperations.map((operation) => operation.faseParada)).join(" / "),
        centersLabel: uniqueSorted(orderedOperations.map((operation) => operation.centroTrabalho)).join(", "),
        leadDescription: orderedOperations.find((operation) => operation.descricao.trim())?.descricao ?? "Sem descricao",
      };
    })
    .sort((a, b) => b.progress.pendingWeight - a.progress.pendingWeight || a.ordem.localeCompare(b.ordem));

  const phaseSummaries = operations.reduce<Record<string, { operations: OperationRecord[] }>>((acc, operation) => {
    if (!operation.faseParada.trim()) return acc;
    acc[operation.faseParada] ??= { operations: [] };
    acc[operation.faseParada].operations.push(operation);
    return acc;
  }, {});

  return {
    operations,
    orders,
    attachments: activeAttachments,
    phaseSummaries: Object.fromEntries(
      Object.entries(phaseSummaries).map(([phase, group]) => [
        phase,
        {
          phase,
          taskCount: group.operations.length,
          orderCount: new Set(group.operations.map((operation) => operation.ordem)).size,
          centerCount: new Set(group.operations.map((operation) => operation.centroTrabalho).filter(Boolean)).size,
          totalWork: group.operations.reduce((sum, operation) => sum + operation.trabalho, 0),
          progress: calculateProgress(group.operations),
        },
      ]),
    ),
    loadedAt: new Date().toISOString(),
  };
}
