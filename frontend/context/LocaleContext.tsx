"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useRouter } from "next/router";
import { useAuth } from "./AuthContext";

type Locale = "en" | "zh";

interface LocaleContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: "en",
  setLocale: () => {},
});

async function persistLocaleToAgent(businessId: number | null | undefined, locale: string) {
  if (!businessId) return;
  try {
    await fetch("/agui/locale", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ business_id: businessId, locale }),
    });
  } catch {
    // non-fatal — agent falls back to "en"
  }
}

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user } = useAuth();
  const [locale, setLocaleState] = useState<Locale>("en");

  // On mount, read persisted preference and push to agent context
  useEffect(() => {
    const saved = localStorage.getItem("schub_locale") as Locale | null;
    if (saved && (saved === "en" || saved === "zh")) {
      setLocaleState(saved);
      if (router.locale !== saved) {
        router.replace(router.asPath, undefined, { locale: saved, shallow: false });
      }
    }
  }, []);

  // Whenever the user or locale changes, sync to Redis via switch-service
  useEffect(() => {
    persistLocaleToAgent(user?.business?.id, locale);
  }, [locale, user?.business?.id]);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    localStorage.setItem("schub_locale", l);
    router.replace(router.asPath, undefined, { locale: l, shallow: false });
  }, [router]);

  return (
    <LocaleContext.Provider value={{ locale, setLocale }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  return useContext(LocaleContext);
}
