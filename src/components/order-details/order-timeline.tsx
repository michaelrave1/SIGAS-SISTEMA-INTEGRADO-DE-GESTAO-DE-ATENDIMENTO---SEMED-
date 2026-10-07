import { Pagination, date } from "@/components/ui";
import {
  orderTimelineEventLabel,
  orderTimelineTransition,
  orderTimelineActorColor,
} from "@/lib/order-timeline";
import { UserAvatar } from "@/components/user-avatar";
import type { OrderTimelineEvent } from "./types";

export function OrderTimeline({
  orderId,
  events,
  page,
  total,
  actors = [],
}: {
  orderId: string;
  events: OrderTimelineEvent[];
  page: number;
  total: number;
  actors?: { event_id: number; actor_key: string; avatar_url: string | null }[];
}) {
  const actorMap = new Map(actors.map((actor) => [actor.event_id, actor]));
  return (
    <section
      className="card functional-timeline"
      aria-labelledby="timeline-title"
    >
      <div className="section-head">
        <div>
          <p className="eyebrow">LINHA DO TEMPO</p>
          <h2 id="timeline-title">Histórico funcional</h2>
          <p className="muted">
            Eventos do ciclo da ordem em ordem cronológica.
          </p>
        </div>
      </div>
      <ol>
        {events.map((event) => {
          const actor = actorMap.get(event.event_id);
          const transition = orderTimelineTransition(
            event.from_status,
            event.to_status,
          );
          return (
            <li
              key={event.event_id}
              className={`timeline-primary-${orderTimelineActorColor(actor?.actor_key ?? event.actor_name) % 7}`}
            >
              <span className="functional-timeline-marker" aria-hidden="true" />
              <article>
                <div className="functional-timeline-heading">
                  <strong>
                    {orderTimelineEventLabel(
                      event.event_type,
                      event.from_status,
                    )}
                  </strong>
                  <time dateTime={event.created_at}>
                    {date(event.created_at)}
                  </time>
                </div>
                <p className="timeline-actor">
                  <UserAvatar url={actor?.avatar_url ?? null} />
                  <span className="timeline-actor-name">
                    {event.actor_name}
                  </span>
                  {event.actor_role && <span>{event.actor_role}</span>}
                  {event.actor_unit_name && (
                    <span>{event.actor_unit_name}</span>
                  )}
                </p>
                {transition && (
                  <p className="timeline-transition">{transition}</p>
                )}
                {event.summary && (
                  <p className="timeline-summary">{event.summary}</p>
                )}
              </article>
            </li>
          );
        })}
      </ol>
      {!events.length && (
        <p className="empty">Nenhum evento funcional disponível.</p>
      )}
      <Pagination page={page} total={total} base={`/ordens/${orderId}`} />
    </section>
  );
}
