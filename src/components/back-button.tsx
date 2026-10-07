"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createContext, useContext } from "react";

export const BackButtonContext = createContext(false);

export function BackButton({
  fallback = "/",
  standalone = false,
}: {
  fallback?: string;
  standalone?: boolean;
}) {
  const router = useRouter();
  const hasHeaderButton = useContext(BackButtonContext);
  if (standalone && hasHeaderButton) return null;
  return (
    <button
      type="button"
      className="secondary back-button"
      onClick={() => {
        if (window.history.length > 1) router.back();
        else router.push(fallback);
      }}
    >
      <ArrowLeft size={18} aria-hidden="true" />
      Voltar
    </button>
  );
}
