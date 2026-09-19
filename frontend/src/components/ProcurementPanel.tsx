'use client';

import { motion } from 'framer-motion';
import { useJenga } from '@/store/useJenga';

/**
 * Extracted from the old AttributionLedger.tsx, which bundled this with the
 * delay attribution ledger (now merged into Timeline.tsx instead). This
 * section is otherwise unrelated to delay attribution — it just used to
 * share a rail with it — so it moved here verbatim rather than disappearing.
 */
export function ProcurementPanel() {
  const purchaseOrders = useJenga((s) => s.purchaseOrders);

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto border-t border-slate-200 bg-white p-3">
      <h3 className="text-[10px] uppercase tracking-wider text-slate-400">
        Procurement (Zip)
      </h3>
      <div className="flex flex-col gap-1.5">
        {purchaseOrders.map((po) => (
          <motion.div
            key={po.id}
            layout
            className={`rounded-lg border p-2 text-[10px] ${
              po.status === 'rescheduled'
                ? 'border-sky-200 bg-sky-50'
                : 'border-slate-200 bg-slate-50'
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
      </div>
    </section>
  );
}
