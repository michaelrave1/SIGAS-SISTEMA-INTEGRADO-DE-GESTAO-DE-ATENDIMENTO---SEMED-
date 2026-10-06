"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  acknowledgeDispatch,
  acknowledgeMessage,
  pendingAcknowledgements,
} from "@/app/actions/acknowledgements";
import type {
  AcknowledgementState,
  PendingAcknowledgement,
} from "@/lib/order-acknowledgements";

export function AcknowledgementGate({
  initial,
  children,
}: {
  initial: AcknowledgementState;
  children: React.ReactNode;
}) {
  const [items, setItems] = useState(initial.ok ? initial.items : []);
  const [error, setError] = useState(initial.ok ? "" : initial.error);
  const [busy, setBusy] = useState<string | null>(null);
  const requestRunning = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const path = usePathname();
  const router = useRouter();
  const blocked = items.length > 0 || Boolean(error);

  const refresh = useCallback(
    async (target?: PendingAcknowledgement) => {
      // Serializar polling e cliques evita que uma resposta antiga restaure pendências já confirmadas.
      if (requestRunning.current) return;
      requestRunning.current = true;
      setBusy(target?.id ?? "refresh");
      try {
        const result = target
          ? target.kind === "message"
            ? await acknowledgeMessage(target.id)
            : await acknowledgeDispatch(target.id)
          : await pendingAcknowledgements();
        if (result.ok) {
          setItems(result.items);
          setError("");
          if (target) router.refresh();
        } else setError(result.error);
      } catch {
        setError(
          "Falha de comunicação. Tente novamente para verificar suas pendências.",
        );
      } finally {
        requestRunning.current = false;
        setBusy(null);
      }
    },
    [router],
  );

  useEffect(() => {
    const element = dialog.current;
    if (blocked && element && !element.open) element.showModal();
    if (!blocked && element?.open) element.close();
  }, [blocked]);

  useEffect(() => {
    // Layouts persistem entre páginas: renovar no acesso, na navegação e ao retornar à aba.
    const refreshNow = () => {
      void refresh();
    };
    const navigationCheck = window.setTimeout(refreshNow, 0);
    const interval = window.setInterval(refreshNow, 30000);
    window.addEventListener("focus", refreshNow);
    return () => {
      window.clearTimeout(navigationCheck);
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshNow);
    };
  }, [path, refresh]);

  return (
    <>
      <div inert={blocked} aria-hidden={blocked || undefined}>
        {children}
      </div>
      <dialog
        ref={dialog}
        className="acknowledgement-dialog"
        aria-labelledby="acknowledgement-title"
        aria-describedby="acknowledgement-description"
        onCancel={(event) => event.preventDefault()}
        onClose={() => {
          if (blocked) dialog.current?.showModal();
        }}
      >
        <h2 id="acknowledgement-title">CIÊNCIA OBRIGATÓRIA</h2>
        <p id="acknowledgement-description">
          Confirme individualmente a ciência de cada encaminhamento e mensagem
          para continuar. Esta confirmação não inicia o atendimento da OS.
        </p>
        <p aria-live="polite">{items.length} ciência(s) pendente(s).</p>
        {error && <p role="alert">{error}</p>}
        <ul className="acknowledgement-list" aria-busy={busy !== null}>
          {items.map((item) => (
            <li key={item.id}>
              <div>
                <strong>OS {item.protocol}</strong>
                <p>
                  <strong>
                    {item.kind === "message" ? "Mensagem" : "Encaminhamento"}
                  </strong>
                </p>
                <p>{item.title}</p>
                {item.kind === "message" && (
                  <>
                    <small>
                      Enviada por {item.author_name ?? "Equipe da OS"}
                    </small>
                    <p
                      style={{
                        whiteSpace: "pre-wrap",
                        overflowWrap: "anywhere",
                      }}
                    >
                      {item.body}
                    </p>
                  </>
                )}
                <small>
                  {item.kind === "message"
                    ? "Mensagem enviada em"
                    : "Encaminhada em"}{" "}
                  {new Date(item.encaminhado_em).toLocaleString("pt-BR", {
                    timeZone: "America/Sao_Paulo",
                  })}
                </small>
              </div>
              <button
                disabled={busy !== null}
                onClick={() => void refresh(item)}
                aria-label={`Ciente ${item.kind === "message" ? "da mensagem" : "do encaminhamento"} da OS ${item.protocol}`}
              >
                {busy === item.id ? "REGISTRANDO…" : "CIENTE"}
              </button>
            </li>
          ))}
        </ul>
        <button
          className="secondary"
          disabled={busy !== null}
          onClick={() => void refresh()}
        >
          {busy === "refresh" ? "ATUALIZANDO…" : "ATUALIZAR LISTA"}
        </button>
      </dialog>
      {blocked && (
        <noscript>
          Ative o JavaScript para registrar a ciência obrigatória e continuar.
        </noscript>
      )}
    </>
  );
}
