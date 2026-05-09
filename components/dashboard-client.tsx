"use client";

import Image from "next/image";
import { useEffect, useMemo, useState, useTransition, type CSSProperties } from "react";
import { APP_STATUS, APP_STATUSES, type AppStatus, type OperationRecord, type OrderSummary, type ProgressBreakdown, type WorkbookSnapshot } from "@/types/domain";
import { calculateProgress, operationWeight } from "@/lib/progress";
import { cn, displayOptional, formatFileSize, formatNumber, formatPercent } from "@/lib/format";
import { normalizeStatus, statusClass } from "@/lib/status";

const MAIN_PAGE_OPERATIONS = "operacoes";
const MAIN_PAGE_CURVE = "curva";
const TAB_OPERATIONS = "operacoes";
const TAB_ATTACHMENTS = "anexos";
const TAB_PROGRESS = "andamento";
const HOME_PHASES = ["Pre-parada", "Parada"];
const CURVE_LEFT_X = 8;
const CURVE_RIGHT_X = 98;
const CURVE_BOTTOM_Y = 42;
const CURVE_TOP_Y = 6;
const CURVE_HEIGHT = CURVE_BOTTOM_Y - CURVE_TOP_Y;
const CURVE_Y_MARKERS = [0, 25, 50, 75, 100];

type DashboardClientProps = {
  initialSnapshot: WorkbookSnapshot;
};

type EquipmentGroup = {
  equipment: string;
  orders: OrderSummary[];
  taskCount: number;
  totalWork: number;
  progress: ProgressBreakdown;
  orderCount: number;
};

type CenterProgressRow = {
  center: string;
  phases: string;
  taskCount: number;
  inProgressCount: number;
  doneCount: number;
  totalWork: number;
  progressPercent: number;
  inProgressPercent: number;
};

type CurvePoint = {
  date: Date;
  plannedPercent: number;
  actualPercent: number;
  doneAndInProgressPercent: number;
};

type CurveGroup = {
  phase: string;
  points: CurvePoint[];
  axisDates: Date[];
  startDate: Date;
  endDate: Date;
  taskCount: number;
  totalWork: number;
  currentX: number;
  currentPlannedPercent: number;
  currentActualPercent: number;
  currentDoneAndInProgressPercent: number;
  currentDate: Date;
};

function includesText(value: string, search: string) {
  return value.toLocaleLowerCase("pt-BR").includes(search.toLocaleLowerCase("pt-BR"));
}

function normalizePhase(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pt-BR");
}

function phaseShort(phase: string) {
  const normalized = normalizePhase(phase);
  if (normalized.includes("pre")) return "Pre-parada";
  if (normalized.includes("parada")) return "Parada";
  return phase.trim() ? phase : "---";
}

function phaseClass(phase: string) {
  return normalizePhase(phase).includes("pre") ? "pre" : "parada";
}

function percentFromWork(value: number, total: number) {
  return total <= 0 ? 0 : Math.round((value * 1000) / total) / 10;
}

function percentFromCounts(value: number, total: number) {
  return total <= 0 ? 0 : Math.round((value * 1000) / total) / 10;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function curveY(percent: number) {
  return CURVE_BOTTOM_Y - (clamp(percent, 0, 100) * CURVE_HEIGHT) / 100;
}

function curveXFromDate(value: Date, firstDate: Date, lastDate: Date) {
  if (lastDate <= firstDate) return (CURVE_LEFT_X + CURVE_RIGHT_X) / 2;
  const ratio = (value.getTime() - firstDate.getTime()) / (lastDate.getTime() - firstDate.getTime());
  return CURVE_LEFT_X + (CURVE_RIGHT_X - CURVE_LEFT_X) * clamp(ratio, 0, 1);
}

function parseDate(value: string) {
  if (!value.trim()) return null;
  const numeric = Number.parseFloat(value.replace(",", "."));
  if (Number.isFinite(numeric) && numeric > 20000 && numeric < 80000) {
    const excelEpoch = Date.UTC(1899, 11, 30);
    return new Date(excelEpoch + numeric * 24 * 60 * 60 * 1000);
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function buildAxisDates(firstDate: Date, lastDate: Date) {
  if (lastDate < firstDate) return [];
  const days = Math.floor((lastDate.getTime() - firstDate.getTime()) / 86400000) + 1;
  return Array.from({ length: days }, (_, index) => new Date(firstDate.getTime() + index * 86400000));
}

function formatShortDate(date: Date) {
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function curvePath(points: CurvePoint[], selector: (point: CurvePoint) => number) {
  if (!points.length) return "";
  const first = points[0].date;
  const last = points[points.length - 1].date;
  return `M ${points
    .map((point) => `${curveXFromDate(point.date, first, last).toFixed(3)} ${curveY(selector(point)).toFixed(3)}`)
    .join(" L ")}`;
}

function currentProgressPath(curve: CurveGroup) {
  const currentX = clamp(curve.currentX, CURVE_LEFT_X, CURVE_RIGHT_X);
  const currentY = curveY(curve.currentDoneAndInProgressPercent);
  return `M ${CURVE_LEFT_X} ${CURVE_BOTTOM_Y} L ${currentX.toFixed(3)} ${currentY.toFixed(3)} L ${CURVE_RIGHT_X} ${currentY.toFixed(3)}`;
}

function currentLabelStyle(x: number): CSSProperties {
  const left = clamp(x, 8, 92);
  const translate = x > 78 ? "-100%" : x < 22 ? "0" : "-50%";
  return { left: `${left}%`, transform: `translateX(${translate})` };
}

function equipmentName(order: OrderSummary) {
  return order.campoSelecao.trim() ? order.campoSelecao.trim() : "Sem equipamento";
}

function firstCenter(order: OrderSummary) {
  return order.operations.find((operation) => operation.centroTrabalho.trim())?.centroTrabalho ?? "---";
}

function orderByLocale<T>(items: T[], selector: (item: T) => string) {
  return [...items].sort((a, b) => selector(a).localeCompare(selector(b), "pt-BR", { sensitivity: "base" }));
}

function operationKey(operation: OperationRecord) {
  return `${operation.ordem}|${operation.operacao}|${operation.suboperacao}`;
}

export function DashboardClient({ initialSnapshot }: DashboardClientProps) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [selectedOrderId, setSelectedOrderId] = useState(initialSnapshot.orders[0]?.ordem ?? "");
  const [previewAttachmentId, setPreviewAttachmentId] = useState<string | null>(null);
  const [expandedEquipment, setExpandedEquipment] = useState<Set<string>>(new Set());
  const [groupOrdersByEquipment, setGroupOrdersByEquipment] = useState(true);
  const [activeMainPage, setActiveMainPage] = useState(MAIN_PAGE_OPERATIONS);
  const [activeOmTab, setActiveOmTab] = useState(TAB_OPERATIONS);
  const [phaseFilter, setPhaseFilter] = useState("ativas");
  const [statusFilter, setStatusFilter] = useState("");
  const [centerFilter, setCenterFilter] = useState("");
  const [searchText, setSearchText] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const centers = useMemo(
    () => orderByLocale([...new Set(snapshot.operations.map((operation) => operation.centroTrabalho).filter(Boolean))], (value) => value),
    [snapshot.operations],
  );

  const applyOperationFilters = (operations: OperationRecord[], includeStatus = true) => {
    let query = operations;
    const search = searchText.trim();

    if (phaseFilter === "ativas") {
      query = query.filter((operation) => HOME_PHASES.includes(phaseShort(operation.faseParada)));
    } else if (phaseFilter !== "todas") {
      query = query.filter((operation) => phaseShort(operation.faseParada) === phaseFilter);
    }

    if (includeStatus && statusFilter.trim()) {
      query = query.filter((operation) => normalizeStatus(operation.statusApp) === statusFilter);
    }

    if (centerFilter.trim()) {
      query = query.filter((operation) => operation.centroTrabalho === centerFilter);
    }

    if (search) {
      query = query.filter(
        (operation) =>
          includesText(operation.ordem, search) ||
          includesText(operation.campoSelecao, search) ||
          includesText(operation.descricao, search) ||
          includesText(operation.operacao, search) ||
          includesText(operation.suboperacao, search),
      );
    }

    return query;
  };

  const filteredOrders = useMemo(() => {
    const search = searchText.trim();
    let query = snapshot.orders;

    if (phaseFilter === "ativas") {
      query = query.filter((order) => order.operations.some((operation) => HOME_PHASES.includes(phaseShort(operation.faseParada))));
    } else if (phaseFilter !== "todas") {
      query = query.filter((order) => order.operations.some((operation) => phaseShort(operation.faseParada) === phaseFilter));
    }

    if (statusFilter.trim()) {
      query = query.filter((order) => order.operations.some((operation) => normalizeStatus(operation.statusApp) === statusFilter));
    }

    if (centerFilter.trim()) {
      query = query.filter((order) => order.operations.some((operation) => operation.centroTrabalho === centerFilter));
    }

    if (search) {
      query = query.filter(
        (order) =>
          includesText(order.ordem, search) ||
          includesText(order.campoSelecao, search) ||
          order.operations.some(
            (operation) => includesText(operation.descricao, search) || includesText(operation.operacao, search),
          ),
      );
    }

    return [...query].sort((a, b) => b.progress.pendingWeight - a.progress.pendingWeight || a.ordem.localeCompare(b.ordem));
  }, [centerFilter, phaseFilter, searchText, snapshot.orders, statusFilter]);

  useEffect(() => {
    if (!filteredOrders.some((order) => order.ordem === selectedOrderId)) {
      setSelectedOrderId(filteredOrders[0]?.ordem ?? snapshot.orders[0]?.ordem ?? "");
    }
  }, [filteredOrders, selectedOrderId, snapshot.orders]);

  const selectedOrder = snapshot.orders.find((order) => order.ordem === selectedOrderId) ?? filteredOrders[0] ?? snapshot.orders[0];
  const selectedOperations = selectedOrder ? applyOperationFilters(selectedOrder.operations).sort((a, b) => a.rowNumber - b.rowNumber) : [];
  const selectedProgress = calculateProgress(selectedOperations);
  const previewAttachment = selectedOrder?.attachments.find((attachment) => attachment.id === previewAttachmentId);

  const equipmentGroups = useMemo<EquipmentGroup[]>(() => {
    const groups = new Map<string, OrderSummary[]>();
    for (const order of filteredOrders) {
      const key = equipmentName(order);
      groups.set(key, [...(groups.get(key) ?? []), order]);
    }

    return [...groups.entries()]
      .map(([equipment, orders]) => {
        let operations = orders.flatMap((order) => applyOperationFilters(order.operations));
        if (!operations.length) operations = orders.flatMap((order) => order.operations);
        return {
          equipment,
          orders: orderByLocale(orders, (order) => order.ordem),
          taskCount: operations.length,
          totalWork: operations.reduce((sum, operation) => sum + operation.trabalho, 0),
          progress: calculateProgress(operations),
          orderCount: orders.length,
        };
      })
      .sort((a, b) => a.equipment.localeCompare(b.equipment, "pt-BR", { sensitivity: "base" }));
  }, [filteredOrders, phaseFilter, statusFilter, centerFilter, searchText]);

  const curveGroups = useMemo(() => HOME_PHASES.map((phase) => buildCurveGroup(phase, snapshot.operations)), [
    snapshot.operations,
    phaseFilter,
    statusFilter,
    centerFilter,
    searchText,
  ]);

  const centerProgressRows = useMemo<CenterProgressRow[]>(() => {
    if (!selectedOrder) return [];
    const operations = applyOperationFilters(selectedOrder.operations, false);
    const groups = new Map<string, OperationRecord[]>();

    for (const operation of operations) {
      const center = operation.centroTrabalho.trim() || "Sem centro";
      groups.set(center, [...(groups.get(center) ?? []), operation]);
    }

    return [...groups.entries()]
      .map(([center, items]) => {
        const inProgressCount = items.filter((operation) => normalizeStatus(operation.statusApp) === APP_STATUS.inProgress).length;
        const doneCount = items.filter((operation) => normalizeStatus(operation.statusApp) === APP_STATUS.done).length;
        return {
          center,
          phases: [...new Set(items.map((operation) => operation.faseParada).filter(Boolean))].join(" / "),
          taskCount: items.length,
          inProgressCount,
          doneCount,
          totalWork: items.reduce((sum, operation) => sum + operation.trabalho, 0),
          progressPercent: percentFromCounts(inProgressCount + doneCount, items.length),
          inProgressPercent: percentFromCounts(inProgressCount, items.length),
        };
      })
      .sort((a, b) => b.progressPercent - a.progressPercent || a.center.localeCompare(b.center));
  }, [selectedOrder, phaseFilter, centerFilter, searchText]);

  function buildCurveGroup(phase: string, allOperations: OperationRecord[]): CurveGroup {
    if (phaseFilter !== "ativas" && phaseFilter !== "todas" && phaseFilter !== phase) {
      return emptyCurve(phase);
    }

    let operations = allOperations.filter((operation) => phaseShort(operation.faseParada) === phase);
    if (statusFilter.trim()) operations = operations.filter((operation) => normalizeStatus(operation.statusApp) === statusFilter);
    if (centerFilter.trim()) operations = operations.filter((operation) => operation.centroTrabalho === centerFilter);
    if (searchText.trim()) operations = applyOperationFilters(operations);

    const totalWeight = operations.reduce((sum, operation) => sum + operationWeight(operation), 0);
    const totalWork = operations.reduce((sum, operation) => sum + operation.trabalho, 0);
    const currentDate = new Date();
    const currentActualPercent = percentFromWork(
      operations.filter((operation) => normalizeStatus(operation.statusApp) === APP_STATUS.done).reduce((sum, operation) => sum + operationWeight(operation), 0),
      totalWeight,
    );
    const currentDoneAndInProgressPercent = percentFromWork(
      operations
        .filter((operation) => {
          const status = normalizeStatus(operation.statusApp);
          return status === APP_STATUS.done || status === APP_STATUS.inProgress;
        })
        .reduce((sum, operation) => sum + operationWeight(operation), 0),
      totalWeight,
    );
    const dated = operations
      .map((operation) => ({ operation, date: parseDate(operation.fimExecucao) }))
      .filter((item): item is { operation: OperationRecord; date: Date } => item.date !== null)
      .sort((a, b) => a.date.getTime() - b.date.getTime());

    if (!dated.length || totalWeight <= 0) {
      return { ...emptyCurve(phase), taskCount: operations.length, totalWork, currentActualPercent, currentDoneAndInProgressPercent };
    }

    const points: CurvePoint[] = [];
    let planned = 0;
    let actual = 0;
    let doneAndInProgress = 0;
    const dayKeys = [...new Set(dated.map((item) => item.date.toISOString().slice(0, 10)))];

    for (const dayKey of dayKeys) {
      const items = dated.filter((item) => item.date.toISOString().slice(0, 10) === dayKey);
      planned += items.reduce((sum, item) => sum + operationWeight(item.operation), 0);
      actual += items
        .filter((item) => normalizeStatus(item.operation.statusApp) === APP_STATUS.done)
        .reduce((sum, item) => sum + operationWeight(item.operation), 0);
      doneAndInProgress += items
        .filter((item) => {
          const status = normalizeStatus(item.operation.statusApp);
          return status === APP_STATUS.done || status === APP_STATUS.inProgress;
        })
        .reduce((sum, item) => sum + operationWeight(item.operation), 0);
      points.push({
        date: new Date(`${dayKey}T00:00:00`),
        plannedPercent: percentFromWork(planned, totalWeight),
        actualPercent: percentFromWork(actual, totalWeight),
        doneAndInProgressPercent: percentFromWork(doneAndInProgress, totalWeight),
      });
    }

    const startDate = dated[0].date;
    const endDate = dated[dated.length - 1].date;
    const currentX = curveXFromDate(currentDate, startDate, endDate);
    const currentPlannedPercent = percentFromWork(
      dated.filter((item) => item.date <= currentDate).reduce((sum, item) => sum + operationWeight(item.operation), 0),
      totalWeight,
    );

    return {
      phase,
      points,
      axisDates: buildAxisDates(startDate, endDate),
      startDate,
      endDate,
      taskCount: operations.length,
      totalWork,
      currentX,
      currentPlannedPercent,
      currentActualPercent,
      currentDoneAndInProgressPercent,
      currentDate,
    };
  }

  function emptyCurve(phase: string): CurveGroup {
    const today = new Date();
    return {
      phase,
      points: [],
      axisDates: [],
      startDate: today,
      endDate: today,
      taskCount: 0,
      totalWork: 0,
      currentX: 2,
      currentPlannedPercent: 0,
      currentActualPercent: 0,
      currentDoneAndInProgressPercent: 0,
      currentDate: today,
    };
  }

  async function refresh(preferredOrder?: string) {
    const response = await fetch("/api/snapshot", { method: "GET", cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.message ?? "Nao foi possivel atualizar os dados.");
    setSnapshot(body);
    setSelectedOrderId(preferredOrder ?? body.orders[0]?.ordem ?? "");
  }

  async function persistOperation(operation: OperationRecord, status: AppStatus, observation: string) {
    const key = operationKey(operation);
    setSavingKey(key);
    setErrorMessage(null);
    try {
      const response = await fetch("/api/operations/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: {
            ordem: operation.ordem,
            operacao: operation.operacao,
            suboperacao: operation.suboperacao,
          },
          status,
          observation,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? "Nao foi possivel salvar a operacao.");
      await refresh(operation.ordem);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Erro desconhecido ao salvar.");
    } finally {
      setSavingKey(null);
    }
  }

  function clearFilters() {
    setPhaseFilter("ativas");
    setStatusFilter("");
    setCenterFilter("");
    setSearchText("");
    setExpandedEquipment(new Set());
  }

  function toggleEquipment(equipment: string) {
    setExpandedEquipment((current) => {
      const next = new Set(current);
      if (next.has(equipment)) next.delete(equipment);
      else next.add(equipment);
      return next;
    });
  }

  return (
    <section className="h-screen overflow-hidden bg-[var(--page)]">
      <main className="mx-auto grid h-screen w-full max-w-[1780px] grid-rows-[auto_auto_auto_auto_minmax(0,1fr)] gap-3 overflow-hidden px-[18px] py-[14px]">
        <header className="flex min-w-0 items-center justify-between gap-[18px] max-[760px]:flex-col max-[760px]:items-stretch">
          <div className="flex min-w-0 items-center gap-[13px] max-[760px]:flex-col max-[760px]:items-stretch">
            <Image src="/c3-logo.svg" width={238} height={96} alt="C3 Engenharia e Solucoes" className="block h-24 w-[238px] rounded-lg object-contain max-[760px]:h-[84px] max-[760px]:w-52" priority />
            <div>
              <h1 className="text-[clamp(1.65rem,2.4vw,2.55rem)] font-black leading-none text-[var(--text)]">Parada U-700</h1>
              <p className="mt-1 text-[0.84rem] font-bold text-[var(--brand-orange)]">Acompanhamento da Parada</p>
            </div>
          </div>
          <div className="flex min-w-0 items-center justify-end gap-2.5 max-[760px]:flex-col max-[760px]:items-stretch">
            <div className="flex min-h-[42px] items-center gap-2.5 rounded-lg border border-[var(--line)] bg-[rgba(20,34,77,0.92)] px-2.5 py-2">
              <div className="grid h-[30px] w-[30px] place-items-center rounded-full border-2 border-[#101b40] bg-[rgba(238,135,47,0.24)] text-[0.62rem] font-black text-[#fff1e5]">
                {/* TODO: integrar foto/usuario no proximo passo. */}
                APP
              </div>
              <div className="grid min-w-24 gap-0.5">
                <span className="truncate text-[0.68rem] font-black text-[var(--text)]">App Web</span>
                <span className="text-[0.6rem] font-black uppercase text-[var(--brand-orange)]">Supabase SSR</span>
              </div>
            </div>
            <button type="button" className="min-h-[42px] whitespace-nowrap rounded-lg border border-[rgba(238,135,47,0.56)] bg-[rgba(238,135,47,0.18)] px-4 text-[0.72rem] font-black uppercase text-[#ffd9ba]" disabled>
              Verificar SAP
            </button>
            <div className="grid min-w-[188px] gap-0.5 rounded-lg border border-[var(--line)] bg-[rgba(20,34,77,0.92)] px-3 py-2 max-[760px]:w-full">
              <span className="text-[0.62rem] font-extrabold uppercase text-[var(--faint)]">Ultima atualizacao</span>
              <strong className="text-[0.84rem] text-[var(--text)]">{new Date(snapshot.loadedAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</strong>
              <small className="flex items-center gap-1.5 text-[0.62rem] font-extrabold text-[var(--brand-orange)]">
                <i className="h-[7px] w-[7px] rounded-full bg-[var(--brand-orange)]" />
                Supabase conectado
              </small>
            </div>
          </div>
        </header>

        {errorMessage && (
          <div className="grid gap-1 rounded-lg border border-[rgba(212,93,104,0.38)] bg-[rgba(212,93,104,0.13)] p-3 text-[#ffd7dc]">
            <strong>Nao foi possivel salvar.</strong>
            <span className="text-[#efb4bc]">{errorMessage}</span>
          </div>
        )}

        <section className="grid grid-cols-2 gap-3 max-[1180px]:grid-cols-1">
          {HOME_PHASES.map((phase) => {
            const summary = snapshot.phaseSummaries[phase] ?? snapshot.phaseSummaries[phase === "Pre-parada" ? "Pr\u00e9-parada" : phase];
            const progress = summary?.progress ?? calculateProgress([]);
            return (
              <article key={phase} className="grid min-h-[92px] grid-cols-[68px_minmax(0,1fr)] gap-3 rounded-lg border border-[var(--line)] border-l-4 border-l-[var(--brand-orange)] bg-[rgba(20,34,77,0.92)] px-3.5 py-3 shadow-[var(--shadow)]">
                <div className="relative grid h-[58px] w-[58px] place-items-center self-center rounded-full">
                  <svg viewBox="0 0 44 44" aria-hidden="true" className="absolute inset-0 -rotate-90">
                    <circle cx="22" cy="22" r="18" pathLength="100" className="fill-none stroke-[rgba(255,255,255,0.16)] stroke-[5]" />
                    <circle cx="22" cy="22" r="18" pathLength="100" className="fill-none stroke-[var(--brand-orange)] stroke-[5]" strokeDasharray="100" strokeDashoffset={100 - clamp(progress.donePercent, 0, 100)} />
                  </svg>
                  <span className="absolute inset-2 rounded-full bg-[var(--surface)]" />
                  <span className="relative text-[0.72rem] font-black text-[var(--text)]">{formatPercent(progress.donePercent)}</span>
                </div>
                <div className="min-w-0">
                  <h2 className="mb-2 text-[0.93rem] font-black uppercase leading-none text-[var(--text)]">{phase}</h2>
                  <div className="grid grid-cols-4 gap-2.5 max-[1440px]:grid-cols-2">
                    <Metric label="Trabalho (h)" value={formatNumber(summary?.totalWork ?? 0)} />
                    <Metric label="% Concluida" value={formatPercent(progress.donePercent)} progress={progress.donePercent} />
                    <Metric label="Tarefas" value={String(summary?.taskCount ?? 0)} detail={`em ${summary?.orderCount ?? 0} OMs`} />
                    <Metric label="Andamento" value={formatNumber(progress.inProgressWeight)} detail="h em execucao" />
                  </div>
                </div>
              </article>
            );
          })}
        </section>

        <nav className="inline-flex w-max max-w-full items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[rgba(20,34,77,0.86)] p-1">
          <button type="button" className={tabButtonClass(activeMainPage === MAIN_PAGE_OPERATIONS)} onClick={() => setActiveMainPage(MAIN_PAGE_OPERATIONS)}>
            Operacoes
          </button>
          <button type="button" className={tabButtonClass(activeMainPage === MAIN_PAGE_CURVE)} onClick={() => setActiveMainPage(MAIN_PAGE_CURVE)}>
            Curva
          </button>
        </nav>

        <section className="grid grid-cols-[auto_minmax(190px,0.95fr)_minmax(160px,0.75fr)_minmax(150px,0.65fr)_minmax(260px,1.45fr)] items-end gap-2.5 rounded-lg border border-[var(--line)] bg-[rgba(20,34,77,0.86)] p-2.5 max-[1180px]:grid-cols-2 max-[760px]:grid-cols-1">
          <div className="grid min-w-[102px] gap-1 self-stretch max-[1180px]:col-span-full max-[1180px]:grid-cols-[1fr_auto] max-[1180px]:items-center">
            <strong className="text-[0.76rem] font-black uppercase text-[var(--text)]">Filtros</strong>
            <button type="button" onClick={clearFilters} className="min-h-8 rounded-lg border border-[var(--line-strong)] bg-[rgba(32,55,109,0.9)] px-3 text-[0.7rem] font-black text-[var(--brand-orange)]">
              Limpar
            </button>
          </div>
          <FilterLabel label="Fase da parada">
            <select value={phaseFilter} onChange={(event) => setPhaseFilter(event.target.value)} className={fieldClass}>
              <option value="ativas">Ativas (Pre-parada e Parada)</option>
              <option value="Pre-parada">Pre-parada</option>
              <option value="Parada">Parada</option>
              <option value="todas">Todas</option>
            </select>
          </FilterLabel>
          <FilterLabel label="Centro de trabalho">
            <select value={centerFilter} onChange={(event) => setCenterFilter(event.target.value)} className={fieldClass}>
              <option value="">Todos</option>
              {centers.map((center) => (
                <option value={center} key={center}>
                  {center}
                </option>
              ))}
            </select>
          </FilterLabel>
          <FilterLabel label="Status">
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className={fieldClass}>
              <option value="">Todos</option>
              {APP_STATUSES.map((status) => (
                <option value={status} key={status}>
                  {status}
                </option>
              ))}
            </select>
          </FilterLabel>
          <FilterLabel label="Busca">
            <input value={searchText} onChange={(event) => setSearchText(event.target.value)} type="search" placeholder="Buscar por OM, operacao, descricao..." className={fieldClass} />
          </FilterLabel>
        </section>

        {activeMainPage === MAIN_PAGE_CURVE ? (
          <section className="grid min-h-0 grid-cols-2 gap-3 overflow-hidden max-[1180px]:grid-cols-1">
            {curveGroups.map((curve) => (
              <CurveCard key={curve.phase} curve={curve} />
            ))}
          </section>
        ) : (
          <section className="grid min-h-0 grid-cols-[minmax(360px,0.68fr)_minmax(0,1.32fr)] gap-3 overflow-hidden max-[1180px]:grid-cols-1">
            <article className="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-lg border border-[var(--line)] bg-[rgba(20,34,77,0.92)] shadow-[var(--shadow)]">
              <header className="flex items-center justify-between gap-3 border-b border-[var(--line)] bg-[rgba(24,42,92,0.82)] px-3.5 py-3">
                <div className="grid min-w-0 gap-0.5">
                  <h2 className="text-[0.82rem] font-black uppercase text-[var(--text)]">{groupOrdersByEquipment ? "Equipamentos" : "Ordens"}</h2>
                  <span className="text-[0.7rem] font-extrabold text-[var(--brand-orange)]">
                    {equipmentGroups.length} equipamentos - {filteredOrders.length} ordens
                  </span>
                </div>
                <button type="button" onClick={() => setGroupOrdersByEquipment((value) => !value)} className={cn("min-h-[30px] whitespace-nowrap rounded-lg border px-3 text-[0.64rem] font-black uppercase", groupOrdersByEquipment ? "border-[rgba(238,135,47,0.52)] bg-[rgba(238,135,47,0.16)] text-[var(--brand-orange)]" : "border-[var(--line)] bg-[rgba(12,23,57,0.45)] text-[var(--muted)]")}>
                  {groupOrdersByEquipment ? "Agrupado" : "Lista"}
                </button>
              </header>
              <div className="min-h-0 overflow-y-auto overflow-x-hidden">
                {groupOrdersByEquipment ? (
                  equipmentGroups.map((equipment) => (
                    <section key={equipment.equipment} className="m-1.5 grid gap-1">
                      <button type="button" onClick={() => toggleEquipment(equipment.equipment)} className="grid min-h-12 w-full grid-cols-[24px_minmax(58px,1fr)_max-content_minmax(68px,0.42fr)] items-center gap-2 rounded-lg border border-[var(--line)] bg-[rgba(12,23,57,0.5)] p-2 text-left text-[var(--text)] hover:border-[var(--line-strong)] hover:bg-[rgba(32,55,109,0.72)]">
                        <span className="grid h-[22px] w-[22px] place-items-center rounded-md bg-[var(--brand-orange)] text-[0.85rem] font-black text-white">{expandedEquipment.has(equipment.equipment) ? "-" : "+"}</span>
                        <strong className="truncate text-[0.8rem] font-black">{equipment.equipment}</strong>
                        <span className="whitespace-nowrap text-[0.62rem] font-extrabold text-[var(--muted)]">{equipment.orderCount} OMs - {equipment.taskCount} ops</span>
                        <ProgressBar value={equipment.progress.donePercent} />
                      </button>
                      {expandedEquipment.has(equipment.equipment) && (
                        <div className="grid gap-1 pl-2">
                          {equipment.orders.map((order) => (
                            <OrderButton key={order.ordem} order={order} selected={selectedOrder?.ordem === order.ordem} onClick={() => setSelectedOrderId(order.ordem)} />
                          ))}
                        </div>
                      )}
                    </section>
                  ))
                ) : (
                  <div className="grid gap-1 p-1.5">
                    {filteredOrders.map((order) => (
                      <button key={order.ordem} onClick={() => setSelectedOrderId(order.ordem)} className={cn("grid min-h-[58px] grid-cols-[0.85fr_1.1fr_0.55fr_0.9fr] items-center gap-2 rounded-lg border p-2.5 text-left", selectedOrder?.ordem === order.ordem ? "border-[var(--line-strong)] bg-[rgba(32,55,109,0.78)] shadow-[inset_4px_0_0_var(--brand-orange)]" : "border-transparent bg-transparent hover:border-[var(--line-strong)] hover:bg-[rgba(32,55,109,0.78)]")}>
                        <FlatMeta label="OM" value={order.ordem} />
                        <FlatMeta label="Equipamento" value={equipmentName(order)} />
                        <FlatMeta label="Ops" value={`${order.taskCount} ops`} />
                        <span className="grid gap-1">
                          <small className="text-[0.58rem] font-extrabold uppercase text-[var(--faint)]">Progresso</small>
                          <ProgressBar value={order.progress.donePercent} />
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </article>

            {selectedOrder && (
              <section className="relative grid min-h-0 min-w-0 grid-rows-[auto_auto_minmax(0,1fr)] rounded-lg border border-[var(--line)] bg-[rgba(20,34,77,0.92)] shadow-[var(--shadow)]">
                <div className="absolute right-0 top-0 h-0 w-0 border-l-[42px] border-t-[42px] border-l-transparent border-t-[var(--brand-orange)] opacity-90" />
                <header className="grid gap-3 border-b border-[var(--line)] bg-[rgba(24,42,92,0.82)] p-3.5">
                  <div>
                    <span className="inline-flex min-h-[24px] items-center rounded-full border border-[rgba(238,135,47,0.4)] bg-[rgba(238,135,47,0.14)] px-2 text-[0.58rem] font-black uppercase text-[#ffd9ba]">OM selecionada</span>
                    <h2 className="mt-1 text-[1.8rem] font-black leading-none text-[var(--text)]">{selectedOrder.ordem}</h2>
                  </div>
                  <div className="grid grid-cols-4 gap-2 max-[1440px]:grid-cols-2 max-[760px]:grid-cols-1">
                    <OmMeta label="Equipamento" value={equipmentName(selectedOrder)} />
                    <OmMeta label="Fase" value={selectedOrder.phaseLabel || "---"} />
                    <OmMeta label="Centros" value={selectedOrder.centersLabel || "---"} />
                    <OmMeta label="Trabalho" value={`${formatNumber(selectedOrder.totalWork)} h`} />
                  </div>
                </header>
                <nav className="flex border-b border-[var(--line)] bg-[rgba(20,34,77,0.72)]">
                  <button className={omTabClass(activeOmTab === TAB_OPERATIONS)} onClick={() => setActiveOmTab(TAB_OPERATIONS)}>Operacoes</button>
                  <button className={omTabClass(activeOmTab === TAB_PROGRESS)} onClick={() => setActiveOmTab(TAB_PROGRESS)}>Andamento</button>
                  <button className={omTabClass(activeOmTab === TAB_ATTACHMENTS)} onClick={() => setActiveOmTab(TAB_ATTACHMENTS)}>Anexos</button>
                </nav>

                {activeOmTab === TAB_PROGRESS ? (
                  <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-2.5 overflow-auto bg-[rgba(12,23,57,0.3)] p-2.5">
                    <header className="flex items-center justify-between gap-3 rounded-lg border border-[var(--line)] bg-[rgba(20,34,77,0.86)] p-2.5">
                      <h3 className="text-[0.84rem] font-black uppercase text-[var(--text)]">Andamento por centro</h3>
                      <strong className="text-[0.68rem] font-black text-[var(--brand-orange)]">{formatPercent(selectedProgress.donePercent)} concluido</strong>
                    </header>
                    <div className="grid content-start gap-2 overflow-auto">
                      {centerProgressRows.map((row) => (
                        <article key={row.center} className="grid grid-cols-[minmax(0,1fr)_minmax(210px,0.34fr)] items-center gap-3.5 rounded-lg border border-[var(--line)] bg-[rgba(20,34,77,0.86)] p-2.5">
                          <div>
                            <strong className="block text-[0.88rem] font-black text-[var(--text)]">{row.center}</strong>
                            <span className="mt-1 block text-[0.66rem] font-bold text-[var(--muted)]">{row.phases || "---"} - {row.taskCount} tarefas - {formatNumber(row.totalWork)} h</span>
                          </div>
                          <div>
                            <strong className="block text-right text-[var(--brand-orange)]">{formatPercent(row.progressPercent)}</strong>
                            <ProgressBar value={row.progressPercent} />
                            <span className="mt-1 block text-[0.66rem] font-bold text-[var(--muted)]">{row.inProgressCount} em andamento - {row.doneCount} concluidas</span>
                          </div>
                        </article>
                      ))}
                    </div>
                  </div>
                ) : activeOmTab === TAB_ATTACHMENTS ? (
                  <AttachmentsPanel selectedOrder={selectedOrder} onPreview={setPreviewAttachmentId} />
                ) : (
                  <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_300px] overflow-hidden max-[1440px]:grid-cols-1">
                    <div className="min-h-0 overflow-auto p-2.5">
                      <div className="grid min-w-[860px] grid-cols-[54px_50px_minmax(160px,1fr)_70px_52px_110px_minmax(160px,0.9fr)] gap-2 rounded-t-lg bg-[#101b40] px-2.5 py-2 text-[0.6rem] font-extrabold uppercase text-[var(--faint)]">
                        <span>OP.</span><span>Sub.</span><span>Descricao da operacao</span><span>Centro</span><span>HS</span><span>Status</span><span>Observacao</span>
                      </div>
                      {selectedOperations.length === 0 && <div className="rounded-b-lg border border-dashed border-[var(--line-strong)] bg-[rgba(32,55,109,0.38)] p-3.5 text-[var(--muted)]">Nenhuma operacao desta OM atende aos filtros atuais.</div>}
                      {selectedOperations.map((operation) => {
                        const saving = savingKey === operationKey(operation) || isPending;
                        return (
                          <article key={operationKey(operation)} className="grid min-w-[860px] grid-cols-[54px_50px_minmax(160px,1fr)_70px_52px_110px_minmax(160px,0.9fr)] items-center gap-2 border-t border-[var(--line)] bg-[rgba(20,34,77,0.72)] px-2.5 py-2">
                            <span className="truncate text-[0.7rem] font-black text-[var(--text)]">{operation.operacao}</span>
                            <span className="truncate text-[0.68rem] text-[var(--muted)]">{displayOptional(operation.suboperacao)}</span>
                            <strong className="truncate text-[0.72rem] font-black text-[var(--text)]" title={operation.descricao}>{operation.descricao}</strong>
                            <span className="truncate text-[0.68rem] text-[var(--muted)]">{operation.centroTrabalho}</span>
                            <span className="text-[0.68rem] text-[var(--muted)]">{formatNumber(operation.trabalho)}</span>
                            <select disabled={saving} value={normalizeStatus(operation.statusApp)} onChange={(event) => startTransition(() => void persistOperation(operation, event.target.value as AppStatus, operation.observacaoApp))} className={statusSelectClass(operation.statusApp)}>
                              {APP_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
                            </select>
                            <textarea disabled={saving} rows={1} defaultValue={operation.observacaoApp} placeholder="---" onBlur={(event) => {
                              if (event.currentTarget.value !== operation.observacaoApp) {
                                startTransition(() => void persistOperation(operation, normalizeStatus(operation.statusApp), event.currentTarget.value));
                              }
                            }} className="min-h-8 max-h-[72px] w-full resize-y rounded-lg border border-[var(--line)] bg-[rgba(12,23,57,0.78)] p-2 text-[0.68rem] text-[var(--text)] outline-none focus:border-[var(--brand-orange)] focus:shadow-[0_0_0_3px_rgba(238,135,47,0.14)]" />
                          </article>
                        );
                      })}
                    </div>
                    <AttachmentsPanel selectedOrder={selectedOrder} onPreview={setPreviewAttachmentId} compact />
                  </div>
                )}
              </section>
            )}
          </section>
        )}
      </main>

      {previewAttachment && (
        <div className="fixed inset-0 z-[2000] grid place-items-center bg-[rgba(4,7,26,0.78)] p-7" onClick={() => setPreviewAttachmentId(null)}>
          <figure className="relative grid h-[min(760px,88vh)] w-[min(1180px,94vw)] grid-rows-[minmax(0,1fr)_auto] overflow-hidden rounded-lg border border-[var(--line-strong)] bg-[var(--surface)] shadow-[0_24px_70px_rgba(0,0,0,0.44)]" onClick={(event) => event.stopPropagation()}>
            <button type="button" className="absolute right-2.5 top-2.5 z-10 grid h-9 w-9 place-items-center rounded-lg border border-white/20 bg-[var(--brand-orange)] text-xl text-white" onClick={() => setPreviewAttachmentId(null)}>x</button>
            <div className="grid place-items-center bg-[#090f2a] text-[var(--muted)]">TODO: integrar preview da foto via Supabase Storage.</div>
            <figcaption className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 p-2">
              <strong className="truncate text-[0.62rem] font-extrabold text-[var(--muted)]">{previewAttachment.originalFileName}</strong>
              <span className="text-[0.62rem] font-extrabold text-[var(--muted)]">{formatFileSize(previewAttachment.size)}</span>
            </figcaption>
          </figure>
        </div>
      )}
    </section>
  );
}

const fieldClass = "min-h-[34px] w-full rounded-lg border border-[var(--line)] bg-[rgba(12,23,57,0.78)] px-2.5 text-[var(--text)] outline-none focus:border-[var(--brand-orange)] focus:shadow-[0_0_0_3px_rgba(238,135,47,0.14)]";

function tabButtonClass(active: boolean) {
  return cn("min-h-8 rounded-[7px] border px-4 text-[0.72rem] font-black uppercase", active ? "border-[var(--line-strong)] bg-[rgba(32,55,109,0.86)] text-[var(--brand-orange)]" : "border-transparent bg-transparent text-[var(--muted)]");
}

function omTabClass(active: boolean) {
  return cn("min-h-[42px] border-b-2 px-4 text-[0.68rem] font-black uppercase", active ? "border-[var(--brand-orange)] text-[var(--brand-orange)]" : "border-transparent text-[var(--muted)]");
}

function statusSelectClass(status: string) {
  const current = statusClass(status);
  return cn(
    "min-h-8 w-full rounded-lg border bg-[rgba(12,23,57,0.78)] px-2 text-[0.64rem] font-black outline-none",
    current === "done" && "border-white/40 bg-[rgba(47,141,181,0.24)] text-[#d8f1ff]",
    current === "doing" && "border-[rgba(238,135,47,0.72)] bg-[rgba(238,135,47,0.2)] text-[#ffd6b3]",
    current === "pending" && "border-[rgba(115,133,163,0.72)] bg-[rgba(115,133,163,0.2)] text-[#d9e1ee]",
  );
}

function Metric({ label, value, detail, progress }: { label: string; value: string; detail?: string; progress?: number }) {
  return (
    <div className="min-w-0">
      <span className="text-[0.6rem] font-extrabold uppercase text-[var(--faint)]">{label}</span>
      <strong className="mt-0.5 block truncate text-[0.96rem] font-black text-[var(--text)]">{value}</strong>
      {progress !== undefined && <ProgressBar value={progress} className="mt-1.5" />}
      {detail && <small className="mt-0.5 block text-[0.6rem] font-extrabold text-[var(--muted)]">{detail}</small>}
    </div>
  );
}

function ProgressBar({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cn("relative block h-1.5 min-w-[54px] overflow-hidden rounded-full bg-[rgba(151,182,220,0.2)]", className)}>
      <i className="block h-full rounded-[inherit] bg-[var(--brand-orange)]" style={{ width: `${clamp(value, 0, 100)}%` }} />
      <em className="sr-only">{formatPercent(value)}</em>
    </span>
  );
}

function FilterLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid min-w-0 gap-1">
      <span className="text-[0.62rem] font-extrabold uppercase text-[var(--faint)]">{label}</span>
      {children}
    </label>
  );
}

function OrderButton({ order, selected, onClick }: { order: OrderSummary; selected: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={cn("grid min-h-11 w-full grid-cols-[minmax(78px,0.95fr)_minmax(68px,0.72fr)_minmax(52px,0.6fr)_40px_minmax(54px,0.55fr)] items-center gap-1.5 rounded-lg border p-2 text-left", selected ? "border-[var(--line-strong)] bg-[rgba(32,55,109,0.78)] shadow-[inset_4px_0_0_var(--brand-orange)]" : "border-transparent bg-transparent hover:border-[var(--line-strong)] hover:bg-[rgba(32,55,109,0.78)]")}>
      <strong className="truncate text-[0.72rem] font-black text-[var(--text)]">{order.ordem}</strong>
      <span className={cn("inline-flex min-h-[23px] items-center justify-center rounded-full px-2 text-[0.62rem] font-black", phaseClass(order.phaseLabel) === "pre" ? "bg-[rgba(103,199,212,0.15)] text-[#9ce5ef]" : "bg-[rgba(74,154,212,0.17)] text-[#b9dfff]")}>{phaseShort(order.phaseLabel)}</span>
      <span className="truncate text-[0.64rem] font-bold text-[var(--muted)]">{firstCenter(order)}</span>
      <span className="truncate text-[0.64rem] font-bold text-[var(--muted)]">{formatNumber(order.totalWork)}</span>
      <ProgressBar value={order.progress.donePercent} />
    </button>
  );
}

function FlatMeta({ label, value }: { label: string; value: string }) {
  return (
    <span className="grid gap-1">
      <small className="text-[0.58rem] font-extrabold uppercase text-[var(--faint)]">{label}</small>
      <strong className="truncate text-[0.76rem] font-black text-[var(--text)]">{value}</strong>
    </span>
  );
}

function OmMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid min-h-[58px] gap-1 rounded-lg border border-[var(--line)] bg-[rgba(12,23,57,0.36)] p-2">
      <span className="text-[0.6rem] font-extrabold uppercase text-[var(--faint)]">{label}</span>
      <strong className="truncate text-[0.82rem] font-black text-[var(--text)]">{value}</strong>
    </div>
  );
}

function AttachmentsPanel({ selectedOrder, compact, onPreview }: { selectedOrder: OrderSummary; compact?: boolean; onPreview: (id: string) => void }) {
  return (
    <aside className={cn("grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-2 overflow-hidden bg-[rgba(20,34,77,0.62)] p-2.5", compact ? "" : "bg-[rgba(12,23,57,0.3)]")}>
      <div className="flex items-center justify-between gap-3.5 max-[760px]:flex-col max-[760px]:items-stretch">
        <h3 className="text-[0.78rem] font-black uppercase text-[var(--text)]">Anexos ({selectedOrder.attachments.length})</h3>
        <button type="button" className="min-h-8 rounded-lg bg-[var(--brand-orange)] px-3 text-[0.68rem] font-black text-white" disabled title="TODO: integrar Supabase Storage">
          + Adicionar
        </button>
      </div>
      {selectedOrder.attachments.length === 0 ? (
        <div className="grid min-h-11 place-items-center rounded-lg border border-dashed border-[var(--line-strong)] bg-[rgba(32,55,109,0.38)] text-[var(--muted)]">Adicionar imagens</div>
      ) : (
        <div className={cn("grid content-start gap-2 overflow-auto", compact ? "" : "grid-cols-[repeat(auto-fill,minmax(170px,1fr))]")}>
          {selectedOrder.attachments.map((attachment) => (
            <article key={attachment.id} className={cn("overflow-hidden rounded-lg border border-[var(--line)] bg-[rgba(20,34,77,0.88)]", compact ? "grid min-h-[66px] grid-cols-[82px_minmax(0,1fr)]" : "grid grid-rows-[110px_auto]")}>
              <button type="button" className="grid min-h-[58px] place-items-center bg-[rgba(12,23,57,0.6)] text-[0.62rem] font-extrabold text-[var(--muted)]" onClick={() => onPreview(attachment.id)}>
                TODO foto
              </button>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 p-2">
                <span className="truncate text-[0.62rem] font-extrabold text-[var(--muted)]">{attachment.originalFileName}</span>
                <button type="button" className="min-h-[26px] rounded-lg bg-[var(--danger)] px-2 text-[0.6rem] font-black text-white" disabled title="TODO: exclusao de foto via Supabase Storage">
                  Excluir
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </aside>
  );
}

function CurveCard({ curve }: { curve: CurveGroup }) {
  return (
    <article className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-2.5 rounded-lg border border-[var(--line)] bg-[rgba(20,34,77,0.92)] p-3.5 shadow-[var(--shadow)]">
      <header className="flex items-start justify-between gap-3">
        <div>
          <span className="text-[0.68rem] font-extrabold text-[var(--muted)]">Curva S</span>
          <h2 className="mt-1 text-[1.15rem] font-black text-[var(--text)]">{curve.phase}</h2>
        </div>
        <div className="text-right">
          <span className="text-[0.68rem] font-extrabold text-[var(--muted)]">Finalizado + andamento</span>
          <strong className="block text-[1.35rem] font-black text-[#39ff88]">{formatPercent(curve.currentDoneAndInProgressPercent)}</strong>
          <small className="mt-1 block text-[0.62rem] font-extrabold text-[var(--muted)]">Finalizado {formatPercent(curve.currentActualPercent)} - {curve.taskCount} tarefas - {formatNumber(curve.totalWork)} h</small>
        </div>
      </header>
      {curve.points.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--line-strong)] bg-[rgba(32,55,109,0.38)] p-3.5 text-[var(--muted)]">Sem datas em Fim execucao para montar a curva desta fase.</div>
      ) : (
        <div className="relative grid min-h-0 grid-rows-[minmax(0,1fr)_auto] rounded-lg border border-[var(--line)] bg-[rgba(12,23,57,0.42)] px-2.5 pb-2 pt-2.5">
          <svg className="min-h-[286px] w-full overflow-visible" viewBox="0 0 100 54" preserveAspectRatio="none" aria-label={`Curva S ${curve.phase}`}>
            {CURVE_Y_MARKERS.map((percent) => {
              const markerY = curveY(percent);
              return (
                <g key={percent}>
                  <line x1={CURVE_LEFT_X} y1={markerY} x2={CURVE_RIGHT_X} y2={markerY} stroke="rgba(255,255,255,0.1)" strokeDasharray="1.2 1.8" strokeWidth="0.26" />
                  <text x="1.2" y={markerY + 0.45} fill="var(--faint)" fontSize="1.35" fontWeight="800">{percent}%</text>
                </g>
              );
            })}
            {curve.axisDates.map((date) => {
              const markerX = curveXFromDate(date, curve.startDate, curve.endDate);
              return (
                <g key={date.toISOString()}>
                  <line x1={markerX} y1="6" x2={markerX} y2="42" stroke="rgba(255,255,255,0.12)" strokeDasharray="1.4 1.8" strokeWidth="0.28" />
                  <text x={markerX} y="44.9" textAnchor="end" transform={`rotate(-38 ${markerX} 44.9)`} fill="#c8d5f0" fontSize="1" fontWeight="800" opacity="0.76">{formatShortDate(date)}</text>
                </g>
              );
            })}
            <line x1={CURVE_LEFT_X} y1="42" x2={CURVE_RIGHT_X} y2="42" stroke="rgba(255,255,255,0.12)" strokeWidth="0.4" />
            <line x1={CURVE_LEFT_X} y1="6" x2={CURVE_RIGHT_X} y2="6" stroke="rgba(255,255,255,0.12)" strokeWidth="0.4" />
            <line x1={curve.currentX} y1="6" x2={curve.currentX} y2="42" stroke="var(--brand-orange)" strokeWidth="0.8" vectorEffect="non-scaling-stroke" />
            <path d={curvePath(curve.points, (point) => point.plannedPercent)} fill="none" stroke="rgba(255,255,255,0.48)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            <path d={curvePath(curve.points, (point) => point.actualPercent)} fill="none" stroke="#ff9842" strokeDasharray="5 4" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" opacity="0.86" vectorEffect="non-scaling-stroke" />
            <path d={currentProgressPath(curve)} fill="none" stroke="#39ff88" strokeDasharray="5 4" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            <circle cx={curve.currentX} cy={curveY(curve.currentDoneAndInProgressPercent)} r="1.2" fill="#39ff88" stroke="#101b40" strokeWidth="0.55" vectorEffect="non-scaling-stroke" />
          </svg>
          <div className="pointer-events-none absolute top-[18px] z-10 grid min-w-[166px] gap-0.5 rounded-lg border border-[rgba(238,135,47,0.44)] bg-[rgba(12,23,57,0.94)] px-2 py-1.5 shadow-[0_10px_24px_rgba(0,0,0,0.22)]" style={currentLabelStyle(curve.currentX)}>
            <strong className="text-[0.68rem] font-black text-[var(--brand-orange)]">{formatShortDate(curve.currentDate)}</strong>
            <span className="text-[0.62rem] font-extrabold text-[var(--text)]">Previsto {formatPercent(curve.currentPlannedPercent)}</span>
            <span className="text-[0.62rem] font-extrabold text-[var(--text)]">Finalizado {formatPercent(curve.currentActualPercent)}</span>
            <span className="text-[0.62rem] font-extrabold text-[var(--text)]">Finalizado + andamento {formatPercent(curve.currentDoneAndInProgressPercent)}</span>
          </div>
        </div>
      )}
      <div className="flex items-center gap-3 text-[0.68rem] font-extrabold text-[var(--muted)]">
        <span><i className="mr-1.5 inline-block h-[3px] w-5 rounded-full bg-white/50 align-middle" />Planejado</span>
        <span><i className="mr-1.5 inline-block h-[3px] w-5 rounded-full bg-[#ff9842] align-middle opacity-90" />Finalizado</span>
        <span><i className="mr-1.5 inline-block h-[3px] w-5 rounded-full bg-[#39ff88] align-middle shadow-[0_0_6px_rgba(57,255,136,0.62)]" />Finalizado + andamento</span>
      </div>
    </article>
  );
}
