import React, { useEffect, useState } from "react";
import { FilterBuilder, AuditFilters } from "./FilterBuilder";
import { AuditEventTraceability } from "./AuditEventTraceability";
import { useAuth } from "../../context/AuthContext";
import { useRouter } from "next/router";
import { useTranslation } from "next-i18next/pages";
import DraggablePopup from "../BusinessNetwork/DraggablePopup";

/* =======================
   Types
======================= */

type AuditEvent = {
  id: number;
  created_at: string;
  event_type: string;
  message_id: string;
  target: string;
  materials: string[];
  quantity_decrease_percentage?: number;
  delivery_delay_days?: number;
  source_business_id?: number;
  recipient_business_id?: number;
  color?: string;
};

type AuditViewMode =
  | "all"        // system user
  | "sent"       // business user
  | "received";  // business user

/* =======================
   Helpers
======================= */

function filtersToQueryParams(filters: AuditFilters) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v !== undefined) params.set(k, String(v));
  });
  return params;
}

function applyUserContextToFilters(
  isSystem: boolean,
  base: AuditFilters,
  user: any,
  viewMode: AuditViewMode
): AuditFilters {
  if (isSystem) return base;
  if (!user?.business) return base;

  const businessId = user.business.id;

  if (viewMode === "sent") {
    return {
      ...base,
      source_business_id: businessId,
      recipient_business_id: undefined,
    };
  }

  if (viewMode === "received") {
    return {
      ...base,
      recipient_business_id: businessId,
      source_business_id: undefined,
    };
  }

  return base;
}

/* =======================
   Hook
======================= */

function useAuditEvents(filters: AuditFilters) {
  const [items, setItems] = useState<AuditEvent[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load(reset = false) {
    setLoading(true);

    let effectiveCursor = cursor;
    if (reset) {
      setItems([]);
      setCursor(null);
      effectiveCursor = null;
    }

    const params = filtersToQueryParams(filters);
    if (effectiveCursor) params.set("cursor", effectiveCursor);

    const res = await fetch(`/audit/event?${params.toString()}`);
    const data = await res.json();

    setItems(prev => (reset ? data.items : [...prev, ...data.items]));
    setCursor(data.next_cursor ?? null);
    setLoading(false);
  }

  useEffect(() => {
    load(true);
  }, [JSON.stringify(filters)]);

  return { items, load, hasMore: !!cursor, loading };
}

/* =======================
   Components
======================= */

function AuditViewModeSelector({
  value,
  onChange,
}: {
  value: AuditViewMode;
  onChange: (v: AuditViewMode) => void;
}) {
  const { t } = useTranslation("audit");
  return (
    <div className="view-mode">
      <label>
        <input
          type="radio"
          checked={value === "received"}
          onChange={() => onChange("received")}
        />
        {t("search.received")}
      </label>

      <label>
        <input
          type="radio"
          checked={value === "sent"}
          onChange={() => onChange("sent")}
        />
        {t("search.sent")}
      </label>

      <style jsx>{`
        .view-mode {
          display: flex;
          gap: 16px;
          margin-bottom: 12px;
        }
      `}</style>
    </div>
  );
}

/* =======================
   Audit Table
======================= */
function Legend({
  color,
  label,
}: {
  color: string;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: "50%",
          backgroundColor: color,
          display: "inline-block",
          boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.15)",
        }}
      />
      <span>{label}</span>
    </div>
  );
}

function AuditTable({
  items,
  onSelectEvent,
  hasMore,
  loadMore,
  loading,
}: {
  items: AuditEvent[];
  onSelectEvent?: (event: AuditEvent) => void;
  hasMore?: boolean;
  loadMore?: () => void;
  loading?: boolean;
}) {
  const { t } = useTranslation("audit");
  return (
    <div className="audit-table-wrapper">
      <div className="flex gap-4 text-sm mb-2">
        <Legend color="#cb0b0bff" label={t("search.legend.delay")} />
        <Legend color="#f97316" label={t("search.legend.quantity")} />
        <Legend color="#3b82f6" label={t("search.legend.others")} />
      </div>
      <table className="audit-table">
        <thead>
          <tr>
            <th style={{ width: 48 }}></th> {/* color dot */}
            <th style={{ minWidth: 160 }}>{t("search.table.time")}</th>
            <th style={{ minWidth: 120 }}>{t("search.table.type")}</th>
            <th style={{ minWidth: 120 }}>{t("search.table.messageId")}</th>
            <th style={{ minWidth: 320 }}>{t("search.table.materials")}</th>
            <th style={{ minWidth: 80 }}>{t("search.table.delay")}</th>
            <th style={{ minWidth: 90 }}>{t("search.table.quantity")}</th>
            <th style={{ minWidth: 180 }}>{t("search.table.sourceRecipient")}</th>
          </tr>
        </thead>

        <tbody>
          {items.map(e => (
            <tr
              key={e.id}
              onClick={() => onSelectEvent?.(e)}
              style={{ cursor: "pointer" }}
            >
              {/* Color indicator */}
              <td>
                <span
                  className="color-dot"
                  style={{
                    backgroundColor: e.color ?? "#d1d5db", // fallback gray
                  }}
                  title={e.color}
                />
              </td>

              <td>{new Date(e.created_at).toLocaleString()}</td>
              <td>{e.event_type}</td>
              <td>{e.message_id}</td>
              <td className="materials">{e.materials.join(", ")}</td>
              <td>{e.delivery_delay_days ?? "-"}</td>
              <td>{e.quantity_decrease_percentage ?? "-"}</td>
              <td>
                {e.source_business_id} → {e.recipient_business_id}
              </td>
            </tr>
          ))}
        </tbody>

      </table>

      {hasMore && loadMore && (
        <div className="load-more">
          <button disabled={loading} onClick={loadMore}>
            {loading ? t("search.loading") : t("search.loadMore")}
          </button>
        </div>
      )}

      <style jsx>{`
        .audit-table-wrapper {
          width: 100%;
          overflow-x: auto;
          border: 1px solid #e5e7eb;
          border-radius: 6px;
        }

        .audit-table {
          width: max-content;
          min-width: 100%;
          border-collapse: collapse;
        }

        th,
        td {
          padding: 8px 12px;
          border-bottom: 1px solid #e5e7eb;
          white-space: nowrap;
        }

        thead th {
          position: sticky;
          top: 0;
          background: #fafafa;
          z-index: 1;
          text-align: left;
        }

        tbody tr:hover {
          background: #f1f8ff;
        }

        .materials {
          white-space: normal;
          max-width: 420px;
        }

        .load-more {
          padding: 12px;
          text-align: center;
        }
      `}</style>
    </div>
  );
}

/* =======================
   Page
======================= */

export function AuditSearchPage() {
  const { user, isSystem } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!user) router.push("/signin");
  }, [user, router]);

  const [filters, setFilters] = useState<AuditFilters>({});
  const [viewMode, setViewMode] =
    useState<AuditViewMode>("received");

  const effectiveFilters = applyUserContextToFilters(
    isSystem(),
    filters,
    user,
    viewMode
  );

  const { items, load, hasMore, loading } =
    useAuditEvents(effectiveFilters);

  const [selectedEvent, setSelectedEvent] =
    useState<AuditEvent | null>(null);

  if (!user) return null;

  return (
    <div className="audit-page">
      {!isSystem() && (
        <AuditViewModeSelector
          value={viewMode}
          onChange={setViewMode}
        />
      )}

      <FilterBuilder
        value={filters}
        onChange={setFilters}
      />

      <AuditTable
        items={items}
        onSelectEvent={setSelectedEvent}
        hasMore={hasMore}
        loadMore={() => load(false)}
        loading={loading}
      />

      {selectedEvent && (
        <DraggablePopup
          title={`Traceability`}
          headerColor={"#333"}
          onClose={() => setSelectedEvent(null)}
        >
          <AuditEventTraceability traceId={selectedEvent.message_id} />
        </DraggablePopup>
      )}

      <style jsx>{`
        .audit-page {
          width: 100%;
          padding: 16px 24px;
          box-sizing: border-box;
        }
      `}</style>
    </div>
  );
}
