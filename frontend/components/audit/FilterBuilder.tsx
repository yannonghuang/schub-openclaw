import React from "react";

/* =======================
   Types
======================= */

export type AuditFilters = {
  event_type?: string;
  message_id?: string;
  target?: string;
  material?: string;
  source_business_id?: number;
  recipient_business_id?: number;
  start?: string;
  end?: string;
};

/* =======================
   Component
======================= */

export function FilterBuilder({
  value,
  onChange,
}: {
  value: AuditFilters;
  onChange: (v: AuditFilters) => void;
}) {
  function update<K extends keyof AuditFilters>(
    key: K,
    v: AuditFilters[K]
  ) {
    onChange({
      ...value,
      [key]: v || undefined,
    });
  }

  function clearAll() {
    onChange({});
  }

  return (
    <section className="filter-panel">
      <div className="filter-header">
        <h3>Filters</h3>
        <button className="clear-btn" onClick={clearAll}>
          Clear
        </button>
      </div>

      {/* Active chips */}
      {Object.keys(value).length > 0 && (
        <div className="active-filters">
          {Object.entries(value).map(([k, v]) => (
            <span key={k} className="chip">
              {k}: {String(v)}
              <button onClick={() => update(k as any, undefined)}>×</button>
            </span>
          ))}
        </div>
      )}

      <div className="filter-grid">
        <FilterItem label="Event Type">
          <input
            placeholder="WIP"
            value={value.event_type ?? ""}
            onChange={e => update("event_type", e.target.value)}
          />
        </FilterItem>
        <FilterItem label="Message Id">
          <input
            placeholder="Message Id"
            value={value.message_id ?? ""}
            onChange={e => update("message_id", e.target.value)}
          />
        </FilterItem>
        <FilterItem label="Target">
          <input
            placeholder="supplier"
            value={value.target ?? ""}
            onChange={e => update("target", e.target.value)}
          />
        </FilterItem>

        <FilterItem label="Material">
          <input
            placeholder="Aluminum Sheet"
            value={value.material ?? ""}
            onChange={e => update("material", e.target.value)}
          />
        </FilterItem>

        <FilterItem label="Source Business">
          <input
            type="number"
            value={value.source_business_id ?? ""}
            onChange={e =>
              update(
                "source_business_id",
                e.target.value ? Number(e.target.value) : undefined
              )
            }
          />
        </FilterItem>

        <FilterItem label="Recipient Business">
          <input
            type="number"
            value={value.recipient_business_id ?? ""}
            onChange={e =>
              update(
                "recipient_business_id",
                e.target.value ? Number(e.target.value) : undefined
              )
            }
          />
        </FilterItem>

        <FilterItem label="From">
          <input
            type="datetime-local"
            value={value.start ?? ""}
            onChange={e => update("start", e.target.value)}
          />
        </FilterItem>

        <FilterItem label="To">
          <input
            type="datetime-local"
            value={value.end ?? ""}
            onChange={e => update("end", e.target.value)}
          />
        </FilterItem>
      </div>
    </section>
  );
}

/* =======================
   Small helper
======================= */

function FilterItem({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="filter-item">
      <label>{label}</label>
      {children}
    </div>
  );
}
