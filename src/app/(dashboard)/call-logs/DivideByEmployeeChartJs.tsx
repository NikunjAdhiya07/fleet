"use client";

import { useMemo } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
  type Chart,
  type Plugin,
} from "chart.js";
import ChartDataLabels from "chartjs-plugin-datalabels";
import type { Context as DlContext } from "chartjs-plugin-datalabels";
import { Bar } from "react-chartjs-2";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend, ChartDataLabels);

const COL = { incoming: "#22c55e", outgoing: "#3b82f6", missed: "#ef4444" };

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function truncateName(name: string, maxChars: number) {
  if (name.length <= maxChars) return name;
  return `${name.slice(0, Math.max(1, maxChars - 1))}…`;
}

export type DivideByEmployeeRow = Record<string, string | number>;

type Seg = "missed" | "outgoing" | "incoming";

/**
 * For Chart.js vertical bars, `x` is already the bar’s horizontal center (not the left edge).
 * See getBarBounds(): left = x - width/2. Do not add width/2 again or captions shift sideways.
 */
function topStackLabelAnchor(
  chart: Chart,
  stackId: string,
  dataIndex: number
): { cx: number; yTop: number; barW: number } | null {
  const order: Seg[] = ["missed", "outgoing", "incoming"];
  for (const seg of order) {
    const di = chart.data.datasets.findIndex(
      (d) => (d as { stack?: string; segment?: Seg }).stack === stackId && (d as { segment?: Seg }).segment === seg
    );
    if (di < 0) continue;
    const meta = chart.getDatasetMeta(di);
    const raw = meta.data[dataIndex] as unknown as
      | {
          getProps: (keys: string[]) => { x: number; y: number; base: number; width: number; height: number };
          skip?: boolean;
        }
      | undefined;
    if (!raw || raw.skip) continue;
    const { x, y, base, width, height } = raw.getProps(["x", "y", "base", "width", "height"]);
    if (width > 0 && height > 0) {
      const yTop = typeof base === "number" && !Number.isNaN(base) ? Math.min(y, base) : y;
      return { cx: x, yTop, barW: width };
    }
  }
  return null;
}

function makeEmployeeTopLabelsPlugin(employees: string[], rows: DivideByEmployeeRow[]): Plugin {
  return {
    id: "divideByEmployeeTopLabels",
    afterDatasetsDraw(chart) {
      const ctx = chart.ctx;
      employees.forEach((emp) => {
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const inc = Number(row[`${emp}_incoming`]) || 0;
          const out = Number(row[`${emp}_outgoing`]) || 0;
          const mis = Number(row[`${emp}_missed`]) || 0;
          if (inc + out + mis === 0) continue;

          const pos = topStackLabelAnchor(chart, emp, i);
          if (!pos) continue;

          const nameLine = truncateName(emp, Math.max(4, Math.floor(pos.barW / 5.5)));
          const initials = getInitials(emp);

          ctx.save();
          ctx.textAlign = "center";
          ctx.textBaseline = "bottom";

          ctx.font = "600 8px system-ui, -apple-system, Segoe UI, sans-serif";
          ctx.lineWidth = 3;
          ctx.strokeStyle = "rgba(15, 23, 42, 0.95)";
          ctx.fillStyle = "#cbd5e1";
          ctx.strokeText(nameLine, pos.cx, pos.yTop - 18);
          ctx.fillText(nameLine, pos.cx, pos.yTop - 18);

          ctx.font = "800 11px system-ui, -apple-system, Segoe UI, sans-serif";
          ctx.lineWidth = 3.5;
          ctx.strokeStyle = "rgba(10, 20, 40, 0.95)";
          ctx.fillStyle = "#ffffff";
          ctx.strokeText(initials, pos.cx, pos.yTop - 4);
          ctx.fillText(initials, pos.cx, pos.yTop - 4);
          ctx.restore();
        }
      });
    },
  };
}

type Props = {
  rows: DivideByEmployeeRow[];
  employees: string[];
  minWidthPx?: number;
};

export function DivideByEmployeeChartJs({ rows, employees, minWidthPx }: Props) {
  const topLabelPlugin = useMemo(() => makeEmployeeTopLabelsPlugin(employees, rows), [employees, rows]);

  const data = useMemo(() => {
    const labels = rows.map((r) => String(r.timeRange ?? ""));
    const datasets = employees.flatMap((emp) => {
      const inc = rows.map((r) => Number(r[`${emp}_incoming`]) || 0);
      const out = rows.map((r) => Number(r[`${emp}_outgoing`]) || 0);
      const mis = rows.map((r) => Number(r[`${emp}_missed`]) || 0);
      const countStyle = {
        color: "#ffffff",
        font: { weight: 600 as const, size: 9 },
        formatter: (v: string | number) => (Number(v) > 0 ? String(v) : ""),
        display: (ctx: DlContext) => Number(ctx.dataset.data?.[ctx.dataIndex]) > 0,
      };
      return [
        {
          label: `${emp} · in`,
          data: inc,
          backgroundColor: COL.incoming,
          borderWidth: 0,
          stack: emp,
          segment: "incoming" as const,
          datalabels: { ...countStyle, anchor: "center" as const, align: "center" as const },
        },
        {
          label: `${emp} · out`,
          data: out,
          backgroundColor: COL.outgoing,
          borderWidth: 0,
          stack: emp,
          segment: "outgoing" as const,
          datalabels: { ...countStyle, anchor: "center" as const, align: "center" as const },
        },
        {
          label: `${emp} · missed`,
          data: mis,
          backgroundColor: COL.missed,
          borderWidth: 0,
          borderRadius: { topLeft: 4, topRight: 4, bottomLeft: 0, bottomRight: 0 },
          stack: emp,
          segment: "missed" as const,
          datalabels: { ...countStyle, anchor: "center" as const, align: "center" as const },
        },
      ];
    });
    return { labels, datasets } as import("chart.js").ChartData<"bar">;
  }, [rows, employees]);

  const options = useMemo(
    () =>
      ({
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: "x" as const,
        layout: { padding: { top: 52, right: 4, left: 4, bottom: 4 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "rgba(15, 23, 42, 0.96)",
            titleColor: "#e2e8f0",
            bodyColor: "#cbd5e1",
            borderColor: "rgba(51, 65, 85, 0.9)",
            borderWidth: 1,
            callbacks: {
              title(items) {
                const idx = items[0]?.dataIndex ?? 0;
                return String(rows[idx]?.timeRange ?? "");
              },
              label(item) {
                const v = Number(item.raw);
                if (!v) return "";
                const ds = item.dataset as { label?: string };
                return ` ${ds.label ?? ""}: ${v}`;
              },
            },
          },
          datalabels: { clip: false },
        },
        scales: {
          x: {
            stacked: true,
            ticks: { color: "#9ca3af", maxRotation: 45, minRotation: 45, font: { size: 10 } },
            grid: { color: "rgba(31, 41, 55, 0.45)" },
          },
          y: {
            stacked: true,
            beginAtZero: true,
            ticks: { color: "#9ca3af", precision: 0, font: { size: 10 } },
            grid: { color: "rgba(31, 41, 55, 0.45)" },
          },
        },
      }) satisfies import("chart.js").ChartOptions<"bar">,
    [rows]
  );

  return (
    <div className="h-full w-full min-h-[280px]" style={minWidthPx ? { minWidth: minWidthPx } : undefined}>
      <Bar data={data} options={options} plugins={[topLabelPlugin]} />
    </div>
  );
}
