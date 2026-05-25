import "../index.css";
import "@xyflow/react/dist/style.css";
import {
  ReactFlow,
  Background,
  type Node,
  type Edge,
} from "@xyflow/react";
import { useCallback, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useCallTool, useToolInfo } from "../helpers.js";

// ─── types ────────────────────────────────────────────────────────────────────

interface CostedComponent {
  service: string;
  tier: string;
  count: number;
  hoursPerDay: number;
  monthlyCost: number;
  priceSource?: "live" | "fallback_no_creds" | "fallback_api_error";
}

interface StructuredOutput {
  components: CostedComponent[];
  totalMonthlyCost: number;
  region: string;
  generatedAt: string;
  pricingNote?: string;
}

// ─── service metadata ─────────────────────────────────────────────────────────

type Category = "compute" | "storage" | "network" | "ml" | "data";

const SERVICE_META: Record<string, { category: Category; icon: string }> = {
  EKS: { category: "compute", icon: "⎈" },
  Lambda: { category: "compute", icon: "λ" },
  SageMaker: { category: "ml", icon: "◆" },
  RDS: { category: "data", icon: "🗄" },
  MSK: { category: "data", icon: "⇄" },
  ElastiCache: { category: "data", icon: "⚡" },
  S3: { category: "storage", icon: "▣" },
  ALB: { category: "network", icon: "⇌" },
  CloudFront: { category: "network", icon: "◎" },
  API_Gateway: { category: "network", icon: "⊞" },
};

const CATEGORY_COLORS: Record<Category, { bg: string; border: string; text: string; hex: string }> = {
  compute: { bg: "bg-blue-950", border: "border-blue-500", text: "text-blue-300", hex: "#3b82f6" },
  storage: { bg: "bg-emerald-950", border: "border-emerald-500", text: "text-emerald-300", hex: "#10b981" },
  network: { bg: "bg-amber-950", border: "border-amber-500", text: "text-amber-300", hex: "#f59e0b" },
  ml: { bg: "bg-purple-950", border: "border-purple-500", text: "text-purple-300", hex: "#a855f7" },
  data: { bg: "bg-rose-950", border: "border-rose-500", text: "text-rose-300", hex: "#f43f5e" },
};

// ─── react-flow node builder ──────────────────────────────────────────────────

function buildGraph(components: CostedComponent[]): { nodes: Node[]; edges: Edge[] } {
  const center: Node = {
    id: "arch",
    position: { x: 0, y: 0 },
    data: { label: "Architecture" },
    style: {
      background: "#1e293b",
      border: "1.5px solid #94a3b8",
      color: "#f1f5f9",
      borderRadius: 8,
      padding: "8px 16px",
      fontWeight: 700,
      fontSize: 12,
      fontFamily: "monospace",
    },
  };

  const radius = 220;
  const nodes: Node[] = [center];
  const edges: Edge[] = [];

  components.forEach((c, i) => {
    const angle = (2 * Math.PI * i) / components.length - Math.PI / 2;
    const meta = SERVICE_META[c.service] ?? { category: "compute" as Category, icon: "•" };
    const col = CATEGORY_COLORS[meta.category];

    nodes.push({
      id: c.service,
      position: {
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
      },
      data: {
        label: (
          <div className="text-center leading-tight">
            <div className="text-lg">{meta.icon}</div>
            <div className="text-[10px] font-mono font-bold">{c.service}</div>
            <div className="text-[9px] opacity-70">${c.monthlyCost.toLocaleString()}/mo</div>
          </div>
        ),
      },
      style: {
        background: "#0f172a",
        border: `1.5px solid ${col.hex}`,
        color: col.hex,
        borderRadius: 8,
        padding: "6px 10px",
        fontSize: 11,
        width: 90,
      },
    });

    edges.push({
      id: `e-${c.service}`,
      source: "arch",
      target: c.service,
      style: { stroke: col.hex, strokeWidth: 1.5, opacity: 0.6 },
      animated: false,
    });
  });

  return { nodes, edges };
}

// ─── custom recharts tooltip ──────────────────────────────────────────────────

function CostTooltip({ active, payload }: { active?: boolean; payload?: { value: number; name: string }[] }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-xs font-mono text-slate-200 shadow-xl">
      <span className="text-amber-400 font-bold">${payload[0].value.toLocaleString()}</span>
      <span className="text-slate-400"> /mo</span>
    </div>
  );
}

// ─── slider row ──────────────────────────────────────────────────────────────

interface SliderRowProps {
  component: CostedComponent;
  localCount: number;
  localHours: number;
  onCountChange: (v: number) => void;
  onHoursChange: (v: number) => void;
}

function SliderRow({ component, localCount, localHours, onCountChange, onHoursChange }: SliderRowProps) {
  const meta = SERVICE_META[component.service] ?? { category: "compute" as Category, icon: "•" };
  const col = CATEGORY_COLORS[meta.category];

  return (
    <div className={`rounded-lg border ${col.border} ${col.bg} bg-opacity-30 p-3 space-y-2`}>
      <div className="flex items-center justify-between">
        <span className={`font-mono font-bold text-xs ${col.text}`}>
          {meta.icon} {component.service}
        </span>
        <span className="text-[10px] text-slate-400 font-mono">{component.tier}</span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="flex justify-between text-[10px] text-slate-400 mb-1">
            <span>count</span>
            <span className="text-slate-200 font-mono">{localCount}</span>
          </div>
          <input
            type="range" min={1} max={10} step={1} value={localCount}
            onChange={(e) => onCountChange(Number(e.target.value))}
            className="w-full h-1 appearance-none bg-slate-700 rounded accent-amber-400 cursor-pointer"
          />
        </div>
        <div>
          <div className="flex justify-between text-[10px] text-slate-400 mb-1">
            <span>hrs/day</span>
            <span className="text-slate-200 font-mono">{localHours}</span>
          </div>
          <input
            type="range" min={1} max={24} step={1} value={localHours}
            onChange={(e) => onHoursChange(Number(e.target.value))}
            className="w-full h-1 appearance-none bg-slate-700 rounded accent-amber-400 cursor-pointer"
          />
        </div>
      </div>
    </div>
  );
}

// ─── main component ──────────────────────────────────────────────────────────

export default function CostEstimator() {
  const { input, output, isPending } = useToolInfo<"estimate_architecture">();
  const { callTool, data: recalcData, isPending: isRecalculating } = useCallTool("estimate_architecture");

  const live = (recalcData?.structuredContent ?? output) as StructuredOutput | undefined;

  const [overrides, setOverrides] = useState<Record<string, { count: number; hoursPerDay: number }>>({});

  const getOverride = useCallback((service: string, base: CostedComponent) => ({
    count: overrides[service]?.count ?? base.count,
    hoursPerDay: overrides[service]?.hoursPerDay ?? base.hoursPerDay,
  }), [overrides]);

  const handleSliderChange = useCallback((
    service: string,
    field: "count" | "hoursPerDay",
    value: number,
  ) => {
    if (!input || !live) return;

    const next = { ...overrides, [service]: { ...getOverride(service, { service, count: 1, hoursPerDay: 24, tier: "small", monthlyCost: 0 }), [field]: value } };
    setOverrides(next);

    callTool({
      description: input.description,
      region: input.region,
      components: live.components.map((c) => ({
        service: c.service as "EKS" | "MSK" | "RDS" | "ALB" | "S3" | "CloudFront" | "ElastiCache" | "SageMaker" | "Lambda" | "API_Gateway",
        tier: c.tier as "small" | "medium" | "large",
        count: next[c.service]?.count ?? c.count,
        hoursPerDay: next[c.service]?.hoursPerDay ?? c.hoursPerDay,
      })),
    });
  }, [input, live, overrides, getOverride, callTool]);

  // ── loading state ──────────────────────────────────────────────────────────
  if (isPending) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="text-amber-400 text-2xl animate-pulse font-mono">⟳</div>
          <p className="text-slate-400 text-sm font-mono">
            estimating {input?.region ?? "ap-south-1"}…
          </p>
        </div>
      </div>
    );
  }

  if (!live) return null;

  const { components, totalMonthlyCost, region, generatedAt, pricingNote } = live;
  const hasLivePricing = components.some((c) => c.priceSource === "live");
  const hasApiError = components.some((c) => c.priceSource === "fallback_api_error");
  const { nodes, edges } = buildGraph(components);
  const chartData = components.map((c) => ({ name: c.service, cost: c.monthlyCost }));

  const barColors = components.map((c) => {
    const meta = SERVICE_META[c.service] ?? { category: "compute" as Category };
    return CATEGORY_COLORS[meta.category].hex;
  });

  return (
    <div
      className="min-h-screen bg-slate-950 text-slate-100 font-mono"
      data-llm={`current-total-cost: $${totalMonthlyCost} region: ${region}`}
    >
      {/* ── header ──────────────────────────────────────────────────────── */}
      <div className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-amber-400 text-lg font-bold tracking-widest uppercase">
            AWS Cost Estimator
          </span>
          <span className="text-xs text-slate-500 border border-slate-700 rounded px-2 py-0.5">
            {region}
          </span>
        </div>
        <div className="flex items-center gap-4">
          {isRecalculating && (
            <span className="text-xs text-amber-400 animate-pulse">recalculating…</span>
          )}
          <div className="text-right">
            <div className="text-xs text-slate-500">total / month</div>
            <div className="text-xl font-bold text-amber-400 tabular-nums">
              ${totalMonthlyCost.toLocaleString()}
            </div>
          </div>
        </div>
      </div>

      {pricingNote && (
        <div className={`px-6 py-2 text-xs border-b ${hasLivePricing ? "bg-emerald-950/50 border-emerald-900 text-emerald-400" : hasApiError ? "bg-rose-950/50 border-rose-900 text-rose-400" : "bg-amber-950/50 border-amber-900 text-amber-500"}`}>
          {hasLivePricing ? "✓ " : hasApiError ? "✗ " : "⚠ "}{pricingNote}
        </div>
      )}

      <div className="p-6 space-y-8">

        {/* ── react-flow diagram ────────────────────────────────────────── */}
        <section>
          <h2 className="text-xs text-slate-500 uppercase tracking-widest mb-3">Architecture Graph</h2>
          <div className="rounded-xl border border-slate-800 overflow-hidden" style={{ height: 420 }}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              fitView
              fitViewOptions={{ padding: 0.25 }}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable={false}
              panOnDrag={false}
              zoomOnScroll={false}
              zoomOnPinch={false}
              preventScrolling={false}
            >
              <Background color="#1e293b" gap={24} />
            </ReactFlow>
          </div>
        </section>

        {/* ── cost table ────────────────────────────────────────────────── */}
        <section>
          <h2 className="text-xs text-slate-500 uppercase tracking-widest mb-3">Cost Breakdown</h2>
          <div className="rounded-xl border border-slate-800 overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-900">
                  {["Service", "Tier", "Count", "Hrs/Day", "Monthly Cost", "Source"].map((h) => (
                    <th key={h} className="text-left px-4 py-2.5 text-slate-400 font-semibold tracking-wide uppercase text-[10px]">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {components.map((c, i) => {
                  const meta = SERVICE_META[c.service] ?? { category: "compute" as Category, icon: "•" };
                  const col = CATEGORY_COLORS[meta.category];
                  return (
                    <tr
                      key={c.service}
                      className={`border-b border-slate-800/50 ${i % 2 === 0 ? "bg-slate-950" : "bg-slate-900/40"}`}
                    >
                      <td className="px-4 py-2.5">
                        <span className={`font-bold ${col.text}`}>{meta.icon} {c.service}</span>
                      </td>
                      <td className="px-4 py-2.5 text-slate-400">{c.tier}</td>
                      <td className="px-4 py-2.5 tabular-nums">{c.count}</td>
                      <td className="px-4 py-2.5 tabular-nums">{c.hoursPerDay}h</td>
                      <td className="px-4 py-2.5 tabular-nums font-bold text-slate-200">
                        ${c.monthlyCost.toLocaleString()}
                      </td>
                      <td className="px-4 py-2.5">
                        {c.priceSource === "live" ? (
                          <span className="text-[9px] font-bold uppercase tracking-wide text-emerald-400 border border-emerald-700 rounded px-1.5 py-0.5">live</span>
                        ) : c.priceSource === "fallback_api_error" ? (
                          <span className="text-[9px] font-bold uppercase tracking-wide text-rose-400 border border-rose-800 rounded px-1.5 py-0.5">err</span>
                        ) : (
                          <span className="text-[9px] font-bold uppercase tracking-wide text-slate-500 border border-slate-700 rounded px-1.5 py-0.5">est</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-700 bg-slate-900">
                  <td colSpan={4} className="px-4 py-2.5 text-slate-400 text-[10px] uppercase tracking-wide">Total</td>
                  <td className="px-4 py-2.5 font-bold text-amber-400 tabular-nums text-sm">
                    ${totalMonthlyCost.toLocaleString()}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        {/* ── bar chart ─────────────────────────────────────────────────── */}
        <section>
          <h2 className="text-xs text-slate-500 uppercase tracking-widest mb-3">Cost by Service</h2>
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4" style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis
                  dataKey="name"
                  tick={{ fill: "#64748b", fontSize: 10, fontFamily: "monospace" }}
                  axisLine={{ stroke: "#334155" }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: "#64748b", fontSize: 10, fontFamily: "monospace" }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) => `$${v}`}
                />
                <Tooltip content={<CostTooltip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
                <Bar
                  dataKey="cost"
                  radius={[4, 4, 0, 0]}
                  fill="#f59e0b"
                  label={false}
                  isAnimationActive={false}
                  // per-bar color via the shape prop
                  shape={(props: { x?: number; y?: number; width?: number; height?: number; index?: number }) => {
                    const { x = 0, y = 0, width = 0, height = 0, index = 0 } = props;
                    return (
                      <rect
                        x={x} y={y} width={width} height={height}
                        fill={barColors[index]}
                        rx={4} ry={4}
                      />
                    );
                  }}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* ── sliders ───────────────────────────────────────────────────── */}
        <section>
          <h2 className="text-xs text-slate-500 uppercase tracking-widest mb-3">
            Adjust Configuration
            <span className="ml-2 text-slate-600 normal-case">— drag to recalculate live</span>
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {components.map((c) => {
              const ov = getOverride(c.service, c);
              return (
                <SliderRow
                  key={c.service}
                  component={c}
                  localCount={ov.count}
                  localHours={ov.hoursPerDay}
                  onCountChange={(v) => handleSliderChange(c.service, "count", v)}
                  onHoursChange={(v) => handleSliderChange(c.service, "hoursPerDay", v)}
                />
              );
            })}
          </div>
        </section>

        {/* ── footer ────────────────────────────────────────────────────── */}
        <div className="text-[10px] text-slate-600 text-right pt-2 border-t border-slate-800">
          generated {new Date(generatedAt).toLocaleString()} · prices approximate · {region}
        </div>
      </div>
    </div>
  );
}
