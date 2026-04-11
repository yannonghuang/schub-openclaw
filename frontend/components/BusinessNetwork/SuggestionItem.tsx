export interface Suggestion {
  id: string;
  description: string | null;
  // supply-specific (absent on product suggestions)
  productId?:  string;
  supplyDate?: string | null;
  qty?:        number;
  vendorId?:   string | null;
  locationId?: string | null;
}

/**
 * Single row in a /material or /supply typeahead dropdown.
 *
 * Products  →  id + description (single compact row)
 * Supplies  →  id | productId | supplyDate | qty  (compact row)
 *              + all fields expanded in-place on hover
 */
export function SuggestionItem({ s, active, onSelect }: {
  s: Suggestion;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  const isSupply = s.qty !== undefined;

  const details: [string, string | number | null | undefined][] = isSupply ? [
    ["Product",  s.productId],
    ["Date",     s.supplyDate],
    ["Qty",      s.qty],
    ["Vendor",   s.vendorId],
    ["Location", s.locationId],
    ["Notes",    s.description],
  ] : [];

  return (
    <li
      className={`group px-3 py-1.5 cursor-pointer text-sm select-none ${active ? "bg-blue-100" : "hover:bg-blue-50"}`}
      onMouseDown={(e) => { e.preventDefault(); onSelect(s.id); }}
    >
      {/* ── compact row ── */}
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="font-mono font-medium text-blue-700 flex-shrink-0">{s.id}</span>
        {!isSupply && s.description && (
          <span className="text-gray-400 text-xs truncate">{s.description}</span>
        )}
      </div>

      {/* ── hover expansion (supply only) ── */}
      {isSupply && (
        <div className="hidden group-hover:block mt-1 pt-1 border-t border-gray-100 text-xs space-y-0.5">
          {details
            .filter(([, v]) => v !== null && v !== undefined && v !== "")
            .map(([k, v]) => (
              <div key={k} className="flex gap-1">
                <span className="text-gray-400 w-16 flex-shrink-0">{k}:</span>
                <span className="text-gray-600">{String(v)}</span>
              </div>
            ))}
        </div>
      )}
    </li>
  );
}
