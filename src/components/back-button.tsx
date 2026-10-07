"use client";

import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createContext, useContext, useEffect, useRef } from "react";

const BackButtonContext = createContext<(() => void) | null>(null);

export function BackNavigationProvider({
  children,
  fallback,
}: {
  children: React.ReactNode;
  fallback: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  // Only pages visited inside the authenticated shell enter this history.
  // A new session or full reload starts with the safe internal fallback.
  const visited = useRef<string[]>([]);
  useEffect(() => {
    const current = pathname + window.location.search;
    if (visited.current.at(-1) !== current) visited.current.push(current);
  }, [pathname]);
  const goBack = () => {
    if (visited.current.length > 1) {
      visited.current.pop();
      router.replace(visited.current.at(-1) || fallback);
    } else {
      router.replace(fallback);
    }
  };
  return (
    <BackButtonContext.Provider value={goBack}>
      {children}
    </BackButtonContext.Provider>
  );
}

export function BackButton({
  fallback = "/",
  standalone = false,
}: {
  fallback?: string;
  standalone?: boolean;
}) {
  const router = useRouter();
  const goBack = useContext(BackButtonContext);
  if (standalone && goBack) return null;
  return (
    <button
      type="button"
      className="secondary back-button"
      onClick={() => {
        if (goBack) goBack();
        else router.replace(fallback);
      }}
    >
      <ArrowLeft size={18} aria-hidden="true" />
      Voltar
    </button>
  );
}
