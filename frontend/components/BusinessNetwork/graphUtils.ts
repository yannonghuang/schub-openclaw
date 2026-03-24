import { Network } from "vis-network";

export const saveGraphPositions = (key: string, network: Network) => {
  const positions = (network as any).getPositions();
  localStorage.setItem(key, JSON.stringify(positions));
};

export const loadGraphPositions = (key: string): Record<string, { x: number; y: number }> => {
  try {
    return JSON.parse(localStorage.getItem(key) || "{}");
  } catch {
    return {};
  }
};
