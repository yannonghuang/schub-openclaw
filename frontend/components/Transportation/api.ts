// app/transportations/api.ts
import axios from "axios";
import toast from "react-hot-toast";

const API_BASE = "" // process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

export interface ListTransportationsOptions {
  page?: number;
  page_size?: number;
  sort_by?: string;
  sort_order?: string; //"asc" | "desc";
}

export const listTransportations = async (
  filters: Record<string, any> = {},
  options: ListTransportationsOptions = {}
) => {
  const {
    page = 1,
    page_size = 10,
    sort_by = "id",
    sort_order = "asc",
  } = options;

  const cleanFilters = Object.fromEntries(
    Object.entries(filters).filter(([_, v]) => v !== "" && v != null)
  );

  const url = `${API_BASE}/transportation/search?page=${page}&page_size=${page_size}&sort_by=${sort_by}&sort_order=${sort_order}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cleanFilters),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to fetch transportations: ${res.status} ${errorText}`);
  }

  return await res.json();
};


export const createTransportation = async (data: any) => {
  const res = await axios.post(`${API_BASE}/transportation/`, data);

  toast.success(`Transportation record successfully created for ${JSON.stringify(data)}`);
  return res.data;
};

export const updateTransportation = async (data: any) => {
  const res = await axios.put(`${API_BASE}/transportation/`, data);

  console.log(`res.data = ${JSON.stringify(res.data)}`)

  toast.success(`Transportation record successfully updated for ${JSON.stringify(data)}`);
  return res.data;
};

export const deleteTransportation = async (ids: {
  source_location_id: number;
  target_location_id: number;
  material_id: number;
}) => {
  //const res = await axios.delete(`${API_BASE}/transportation/`, { params: ids });
  const res = await axios.delete(`${API_BASE}/transportation/${ids.source_location_id}/${ids.target_location_id}/${ids.material_id}`);

  toast.success(`Transportation record successfully deleted for ${JSON.stringify(ids)}`);
  return res.data;
};


export const getLocations = async () => {
  const url = `${API_BASE}/location/`;
  const res = await axios.get(url);
  return res.data;    
};

export const getMaterials = async () => {
  const url = `${API_BASE}/material/`;
  const res = await axios.get(url);
  return res.data;       
};
