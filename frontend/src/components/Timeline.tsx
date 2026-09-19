'use client';

import { useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle } from 'lucide-react';
import { STATE_STYLE } from '@/lib/theme';
import { useJenga, type StageEvent } from '@/store/useJenga';
import type { Task } from '@/lib/types';

/** Label gutter, px. Everything right of this is the day axis. */
const LABEL_W = 176;
const ROW_H = 26;
/** Current bar occupies 4..16; the baseline hairline sits at 18..21 beneath it. */
const BAR_TOP = 4;
const BAR_H = 12;
const GHOST_TOP = 18;
const GHOST_H = 3;

const SPRING = { type: 'spring', stiffness: 220, damping: 28 } as const;

export function Timeline() {
  const tasks = useJenga((s) => s.tasks);
  const baseline = useJenga((s) => s.baseline);
  const stageHistory = useJenga((s) => s.stageHistory);
  const projectDuration = useJenga((s) => s.projectDuration);
  const baselineDuration = useJenga((s) => s.baselineDuration);
  const selectedTaskId = useJenga((s) => s.selectedTaskId);
  const selectTask = useJenga((s) => s.selectTask);
  const cascading = useJenga((s) => s.cascading);
  // Delay attribution, merged in from the old standalone AttributionLedger —
  // scoped to whichever task is selected rather than shown as an always-on,
  // unfiltered append-only list.
  const attributions = useJenga((s) => s.attributions);
  // Same idea for procurement, which had its own standalone panel under the
  // 3D view — retired in favor of showing only what's relevant to whichever
  // task is selected, alongside its slip detail, right where the click
  // happened.
  const purchaseOrders = useJenga((s) => s.purchaseOrders);

  /**
   * Derive the axis from the data rather than trusting projectDuration alone:
   * the store only republishes it after the last cascade rank lands, so mid-
   * cascade a moved task's ef would otherwise run off the right edge.
   */
  const span = useMemo(() => {
    let max = Math.max(projectDuration, baselineDuration ?? 0, 1);
    for (const t of tasks) max = Math.max(max, t.ef, t.lf);
    return max;
  }, [tasks, projectDuration, baselineDuration]);

  const rows = useMemo(
    () =>
      [...tasks].sort(
        (a, b) => a.es - b.es || a.depth - b.depth || a.id.localeCompare(b.id),
      ),
    [tasks],
  );

  const gridDays = useMemo(() => {
    const step = Math.max(1, Math.ceil(span / 10));
    const out: number[] = [];
    for (let d = 0; d <= span; d += step) out.push(d);
    return out;
  }, [span]);

  const pct = (day: number) => (day / span) * 100;
  const slip = baselineDuration === null ? 0 : projectDuration - baselineDuration;
  const slipped = slip > 0;

  const selectedAttributions = useMemo(
    () => (selectedTaskId ? attributions.filter((a) => a.task_id === selectedTaskId) : []),
    [attributions, selectedTaskId],
  );
  const selectedPurchaseOrders = useMemo(
    () => (selectedTaskId ? purchaseOrders.filter((po) => po.linked_task === selectedTaskId) : []),
    [purchaseOrders, selectedTaskId],
  );

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-white text-slate-700">
      <header className="flex shrink-0 items-center gap-3 border-b border-slate-200 px-3 py-2">
        <h3 className="text-[10px] uppercase tracking-wider text-slate-400">
          Schedule · baseline vs current
        </h3>

        <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] text-slate-600">
          {projectDuration}d
        </span>

        {slipped && (
          <span className="flex items-center gap-1 rounded border border-red-300 bg-red-50 px-1.5 py-0.5 font-mono text-[10px] text-red-700">
            <AlertTriangle size={10} />+{slip}d vs baseline {baselineDuration}d
          </span>
        )}

        {cascading && (
          <span className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 font-mono text-[10px] text-amber-700">
            propagating…
          </span>
        )}
      </header>

      {rows.length === 0 ? (
        <p className="p-3 text-[11px] leading-relaxed text-slate-400">
          No work packages loaded. Once the graph arrives every package is drawn against the
          project schedule, with its float tail and its baseline position.
        </p>
      ) : (
        <>
          {/* Day axis. Kept out of the scroll body so it stays put vertically; the
              track is percentage-based so it never drifts out of column. */}
          <div className="relative shrink-0 border-b border-slate-200 pb-1 pt-1.5">
            <div className="relative h-3.5" style={{ marginLeft: LABEL_W }}>
              {gridDays.map((d) => (
                <span
                  key={d}
                  className="absolute top-0 -translate-x-1/2 font-mono text-[9px] text-slate-400"
                  style={{ left: `${pct(d)}%` }}
                >
                  {d}d
                </span>
              ))}
              <span
                className={`absolute top-0 -translate-x-full pr-1 font-mono text-[9px] ${
                  slipped ? 'text-red-600' : 'text-slate-500'
                }`}
                style={{ left: `${pct(projectDuration)}%` }}
              >
                finish
              </span>
            </div>
          </div>

          <div className="relative min-h-0 flex-1 overflow-y-auto">
            <div className="relative">
              {/* Gridlines, the completion marker and the slip band all live in one
                  overlay so they span every row and scroll with them. */}
              <div
                className="pointer-events-none absolute inset-y-0 right-0 z-10"
                style={{ left: LABEL_W }}
              >
                {gridDays.map((d) => (
                  <div
                    key={d}
                    className="absolute inset-y-0 w-px bg-slate-100"
                    style={{ left: `${pct(d)}%` }}
                  />
                ))}

                {slipped && (
                  <>
                    <div
                      className="absolute inset-y-0 bg-red-500/10"
                      style={{
                        left: `${pct(baselineDuration!)}%`,
                        width: `${pct(slip)}%`,
                      }}
                    />
                    <div
                      className="absolute inset-y-0 w-px border-l border-dashed border-slate-400"
                      style={{ left: `${pct(baselineDuration!)}%` }}
                    />
                  </>
                )}

                <motion.div
                  initial={false}
                  animate={{ left: `${pct(projectDuration)}%` }}
                  transition={SPRING}
                  className={`absolute inset-y-0 w-px ${
                    slipped ? 'bg-red-600' : 'bg-slate-400'
                  }`}
                />
              </div>

              {rows.map((t) => (
                <Row
                  key={t.id}
                  task={t}
                  base={baseline[t.id]}
                  log={stageHistory[t.id]}
                  selected={t.id === selectedTaskId}
                  onSelect={() => selectTask(t.id === selectedTaskId ? null : t.id)}
                  pct={pct}
                />
              ))}
            </div>
          </div>

          {(selectedAttributions.length > 0 || selectedPurchaseOrders.length > 0) && (
            // Capped rather than left to grow unbounded — same reasoning as
            // VerdictPanel's own max-h-[52%]: without a cap, a task with
            // several attribution/procurement entries could squeeze the row
            // list above toward zero height on a short viewport, since rows
            // only get flex-1 of whatever this shrink-0 sibling leaves behind.
            <div className="flex max-h-[45%] shrink-0 flex-col gap-2 overflow-y-auto border-t border-slate-200 bg-slate-50 p-2.5">
              <AnimatePresence initial={false}>
                {selectedAttributions.map((a) => (
                  <motion.div
                    key={a.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="rounded-lg border border-slate-200 bg-white p-2.5"
                  >
                    <div className="flex items-baseline justify-between">
                      <span className="font-mono text-xs text-slate-700">
                        {a.task_id} · +{a.slip_days}d slip
                      </span>
                    </div>

                    <div className="mt-1.5 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] text-slate-400">
                      <span>Float consumed</span>
                      <span className="text-right text-slate-700">{a.float_consumed}d</span>
                      <span>Downstream</span>
                      <span className="text-right text-slate-700">
                        {a.downstream_affected.length} tasks
                      </span>
                      <span>Project slip</span>
                      <span className="text-right text-red-600">+{a.project_slipped_days}d</span>
                    </div>

                    <div className="mt-2 border-t border-slate-200 pt-1.5">
                      {a.attribution.map((p, i) => (
                        <div key={i} className="mb-1 text-[10px] leading-snug">
                          <div className="flex justify-between gap-2">
                            <span className="text-slate-700">{p.party}</span>
                            <span className="shrink-0 font-mono text-slate-400">{p.days}d</span>
                          </div>
                          <p className="text-slate-500">{p.reason}</p>
                        </div>
                      ))}
                    </div>

                    {a.downstream_affected.length > 0 && (
                      <p className="mt-1 font-mono text-[9px] text-slate-400">
                        {a.downstream_affected.join(' · ')}
                      </p>
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>

              {selectedPurchaseOrders.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  {selectedAttributions.length > 0 && (
                    <h4 className="text-[10px] uppercase tracking-wider text-slate-400">
                      Procurement (Zip)
                    </h4>
                  )}
                  <AnimatePresence initial={false}>
                    {selectedPurchaseOrders.map((po) => (
                      <motion.div
                        key={po.id}
                        layout
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={`rounded-lg border p-2.5 text-[10px] ${
                          po.status === 'rescheduled'
                            ? 'border-sky-200 bg-sky-50'
                            : 'border-slate-200 bg-white'
                        }`}
                      >
                        <div className="flex justify-between">
                          <span className="font-mono text-slate-700">{po.id}</span>
                          <span
                            className={
                              po.status === 'rescheduled' ? 'text-sky-700' : 'text-slate-400'
                            }
                          >
                            {po.status}
                          </span>
                        </div>
                        <p className="text-slate-500">
                          {po.material} · {po.quantity}
                        </p>
                        <p className="text-slate-400">
                          {po.vendor} → {po.delivery_date}
                        </p>
                        {po.last_action && (
                          <p className="mt-1 text-sky-700">{po.last_action}</p>
                        )}
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              )}
            </div>
          )}

          <footer className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-200 px-3 py-1.5 text-[9px] text-slate-400">
            <Swatch className="bg-slate-400">current</Swatch>
            <Swatch className="bg-slate-300 [background-image:repeating-linear-gradient(45deg,#94a3b866_0_3px,transparent_3px_6px)]">
              float tail
            </Swatch>
            <Swatch className="bg-slate-300">baseline (moved only)</Swatch>
            <Swatch className="bg-red-500">critical · zero float</Swatch>
            <span>ticks = stage transitions</span>
          </footer>
        </>
      )}
    </div>
  );
}

function Swatch({ className, children }: { className: string; children: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={`h-2 w-4 rounded-sm ${className}`} />
      {children}
    </span>
  );
}

function Row({
  task: t,
  base,
  log,
  selected,
  onSelect,
  pct,
}: {
  task: Task;
  base: { es: number; ef: number } | undefined;
  log: StageEvent[] | undefined;
  selected: boolean;
  onSelect: () => void;
  pct: (day: number) => number;
}) {
  const style = STATE_STYLE[t.state];
  const moved = !!base && (base.es !== t.es || base.ef !== t.ef);
  // Milestones have zero duration; give them a sliver so they stay clickable.
  const barW = Math.max(pct(t.ef - t.es), 0.5);

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`relative flex w-full items-center text-left transition-colors ${
        selected ? 'bg-slate-100 ring-1 ring-inset ring-slate-300' : 'hover:bg-slate-50'
      }`}
      style={{ height: ROW_H }}
    >
      <div
        className="flex shrink-0 items-center gap-1.5 overflow-hidden px-2"
        style={{ width: LABEL_W }}
      >
        <span className="shrink-0 font-mono text-[10px] text-slate-400">{t.id}</span>
        <span className="truncate text-[10px] text-slate-700">{t.name}</span>
        <span
          className={`ml-auto shrink-0 font-mono text-[9px] ${
            t.is_critical ? 'text-red-600' : 'text-slate-400'
          }`}
        >
          {t.is_critical ? 'CRIT' : `${t.total_float}d`}
        </span>
      </div>

      <div className="relative h-full flex-1">
        {/* Slack the task can absorb before it starts pushing the finish date. */}
        {t.total_float > 0 && (
          <motion.div
            initial={false}
            animate={{ left: `${pct(t.ef)}%`, width: `${pct(t.lf - t.ef)}%` }}
            transition={SPRING}
            className="absolute rounded-r-sm border border-l-0 border-dashed"
            style={{
              top: BAR_TOP,
              height: BAR_H,
              borderColor: `${style.hex}55`,
              backgroundImage: `repeating-linear-gradient(45deg, ${style.hex}33 0 3px, transparent 3px 6px)`,
            }}
          />
        )}

        {/* Where this package sat at load. Drawn only once it has moved — a ghost
            under every untouched bar is noise, and displacement is the signal. */}
        {moved && (
          <div
            className="absolute rounded-sm bg-slate-300"
            style={{
              left: `${pct(base!.es)}%`,
              width: `${Math.max(pct(base!.ef - base!.es), 0.5)}%`,
              top: GHOST_TOP,
              height: GHOST_H,
            }}
          />
        )}

        {/* Animating left/width rather than layout/transform keeps the stage ticks
            inside from being scaled out of shape during the cascade. */}
        <motion.div
          initial={false}
          animate={{ left: `${pct(t.es)}%`, width: `${barW}%` }}
          transition={SPRING}
          className="absolute overflow-hidden rounded-sm"
          style={{
            top: BAR_TOP,
            height: BAR_H,
            background: style.hex,
            opacity: Math.max(style.opacity, 0.45),
            boxShadow: t.is_critical ? '0 0 0 1px #dc2626' : undefined,
          }}
        >
          {/* ponytail: ticks are spaced evenly by index, not by timestamp — the bar
              axis is project days and a transition log is wall clock, so the two do
              not share a scale. They read as "this ticket passed through these
              stages, in this order". Place by real date once tasks carry one. */}
          {log &&
            log.length > 1 &&
            log.map((e, i) => (
              <span
                key={`${e.at}-${i}`}
                className="absolute inset-y-0 w-[2px]"
                style={{
                  left: `${((i + 1) / (log.length + 1)) * 100}%`,
                  background: STATE_STYLE[e.state].hex,
                  boxShadow: '0 0 0 1px rgba(255,255,255,0.7)',
                }}
              />
            ))}
        </motion.div>
      </div>
    </button>
  );
}
