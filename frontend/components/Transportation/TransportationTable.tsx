"use client";

import { useEffect, useState } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { listTransportations, deleteTransportation } from "./api";
import { Pencil, Trash, ChevronLeft, ChevronRight } from "lucide-react";

export default function TransportationTable({ onEdit }) {
  const [data, setData] = useState([]);
  const [filters, setFilters] = useState({ source: "", target: "", material: "", mode: "" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [sortBy, setSortBy] = useState("id");
  const [sortOrder, setSortOrder] = useState("asc");

  const fetchData = async () => {
    try {
      const result = await listTransportations(filters, {
        page,
        page_size: pageSize,
        sort_by: sortBy,
        sort_order: sortOrder,
      });
      setData(result.items);
      setTotal(result.total);
    } catch (err) {
      console.error("Failed to fetch transportations:", err);
    }
  };

  useEffect(() => {
    const timeout = setTimeout(fetchData, 300);
    return () => clearTimeout(timeout);
  }, [page, sortBy, sortOrder, pageSize, JSON.stringify(filters)]);

  const handleDelete = async (t) => {
    await deleteTransportation({
      source_location_id: t.source_location.id,
      target_location_id: t.target_location.id,
      material_id: t.material.id,
    });
    fetchData();
  };

  const toggleSort = (column) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortBy(column);
      setSortOrder("asc");
    }
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="p-4 space-y-4">
      {/* 🔍 Search Filters */}
      <div className="flex flex-wrap gap-2">
        {["source", "target", "material", "mode"].map((f) => (
          <Input
            key={f}
            placeholder={f[0].toUpperCase() + f.slice(1)}
            value={filters[f]}
            onChange={(e) => setFilters({ ...filters, [f]: e.target.value })}
          />
        ))}
        <Button onClick={() => { setPage(1); fetchData(); }}>Search</Button>
        <Button onClick={() => {  setFilters({ source: "", target: "", material: "", mode: "" }); }}>Clear</Button>
      </div>

      {/* 📦 Table */}
      <table className="w-full border border-gray-200 text-sm">
        <thead className="bg-gray-100">
          <tr>
            {[
              ["source_location", "Source"],
              ["target_location", "Target"],
              ["material", "Material"],
              ["mode", "Mode"],
              ["duration", "Duration"],
              ["price", "Price"],
            ].map(([col, label]) => (
              <th
                key={col}
                className="p-2 text-left cursor-pointer select-none"
                onClick={() => toggleSort(col)}
              >
                {label} {sortBy === col ? (sortOrder === "asc" ? "▲" : "▼") : ""}
              </th>
            ))}
            <th className="p-2 text-center">Actions</th>
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr>
              <td colSpan={7} className="text-center py-4 text-gray-500">
                No transportations found
              </td>
            </tr>
          ) : (
            data.map((t, i) => (
              <tr key={i} className="border-t hover:bg-gray-50">
                <td className="p-2">{t.source_location?.name ?? "-"}</td>
                <td className="p-2">{t.target_location?.name ?? "-"}</td>
                <td className="p-2">{t.material?.name ?? "-"}</td>
                <td className="p-2">{t.mode}</td>
                <td className="p-2">{t.duration}</td>
                <td className="p-2">{t.price}</td>
                <td className="p-2 flex gap-2 justify-center">
                  <Button size="sm" variant="secondary" onClick={() => onEdit(t)}>
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => handleDelete(t)}>
                    <Trash className="w-4 h-4 text-red-500" />
                  </Button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {/* 📄 Pagination Controls */}
      <div className="flex justify-between items-center mt-2">
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <span>
            Page {page} of {totalPages || 1} ({total} total)
          </span>

          {/* 🔽 Page Size Selector */}
          <label className="ml-4">
            Show{" "}
            <select
              className="border rounded px-2 py-1"
              value={pageSize}
              onChange={(e) => {
                setPage(1); // reset to first page
                setPageSize(Number(e.target.value));
              }}
            >
              {[5, 10, 25, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>{" "}
            per page
          </label>
        </div>

        <div className="flex gap-2">
          {/* ⏮️ First Page */}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPage(1)}
            disabled={page === 1}
          >
            ⏮ First
          </Button>

          {/* ◀️ Prev */}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
          >
            Prev <ChevronLeft className="w-4 h-4" />
          </Button>

          {/* ▶️ Next */}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
          >
            Next <ChevronRight className="w-4 h-4" />
          </Button>

          {/* ⏭️ Last Page */}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPage(totalPages)}
            disabled={page >= totalPages}
          >
            Last ⏭
          </Button>
        </div>
      </div>

    </div>
  );
}
