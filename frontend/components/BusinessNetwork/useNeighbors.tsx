import { useCallback, useEffect, useState } from "react";

type Material = {
  id: number;
  name: string;
};

export type Neighbor = {
  id: number;
  name: string;
  material?: Material | null;
  type: "supplier" | "customer" | "system" | null;
};

export function useNeighbors({
  neighbors,
  suffix,
  subscribe,
  unsubscribe,
  onUnsubscribe,
}: {
  neighbors: Neighbor[];
  suffix: string;
  subscribe: (channel: string) => void;
  unsubscribe: (channel: string) => void;
  onUnsubscribe?: ((fn: (id: number) => void) => void) | null;
}) {
  /* ---------- SUBSCRIPTIONS ---------- */

  const [subscribedMap, setSubscribedMap] =
    useState<Record<number, boolean>>({});

  const subscribeToNeighbor = useCallback(
    (n: Neighbor) => subscribe(`${n.id}${suffix}`),
    [subscribe, suffix]
  );

  const unsubscribeFromNeighbor = useCallback(
    (n: Neighbor) => unsubscribe(`${n.id}${suffix}`),
    [unsubscribe, suffix]
  );

  const toggleSub = useCallback(
    (n: Neighbor) => {
      setSubscribedMap(prev => {
        const next = { ...prev };
        if (prev[n.id]) {
          unsubscribeFromNeighbor(n);
          delete next[n.id];
        } else {
          subscribeToNeighbor(n);
          next[n.id] = true;
        }
        return next;
      });
    },
    [subscribeToNeighbor, unsubscribeFromNeighbor]
  );

  const subscribeAll = useCallback(() => {
    const next: Record<number, boolean> = {};
    neighbors.forEach(n => {
      subscribeToNeighbor(n);
      next[n.id] = true;
    });
    setSubscribedMap(next);
  }, [neighbors, subscribeToNeighbor]);

  const unsubscribeAll = useCallback(() => {
    neighbors.forEach(unsubscribeFromNeighbor);
    setSubscribedMap({});
  }, [neighbors, unsubscribeFromNeighbor]);

  const allSubscribed =
    neighbors.length > 0 &&
    neighbors.every(n => subscribedMap[n.id]);

  /* ---------- PUBLICATION ---------- */

  const [publishMap, setPublishMap] =
    useState<Record<number, boolean>>({});

  const togglePub = useCallback((n: Neighbor) => {
    setPublishMap(prev => ({
      ...prev,
      [n.id]: !prev[n.id],
    }));
  }, []);

  const selectAllPub = useCallback(() => {
    const next: Record<number, boolean> = {};
    neighbors.forEach(n => (next[n.id] = true));
    setPublishMap(next);
  }, [neighbors]);

  const clearAllPub = useCallback(() => {
    setPublishMap({});
  }, []);

  const allPublished =
    neighbors.length > 0 &&
    neighbors.every(n => publishMap[n.id]);

  /* ---------- PARENT-TRIGGERED UNSUB ---------- */

  useEffect(() => {
    if (!onUnsubscribe) return;

    const fn = (id: number) => {
      unsubscribe(`${id}${suffix}`);
      setSubscribedMap(prev => {
        if (!prev[id]) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
    };

    onUnsubscribe(fn);
  }, [onUnsubscribe, suffix, unsubscribe]);

  return {
    /* sub */
    subscribedMap,
    toggleSub,
//    subscribeAll,
    unsubscribeAll,
//    allSubscribed,

    /* pub */
    publishMap,
    togglePub,
//    selectAllPub,
    clearAllPub,
//    allPublished,
  };
}
