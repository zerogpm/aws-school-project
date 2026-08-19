import { EVENTS } from "../data";

export default function UpcomingEvents() {
  return (
    <section
      aria-labelledby="events-heading"
      className="rounded-lg border border-line bg-white p-6"
    >
      <h2
        id="events-heading"
        className="font-serif text-lg font-semibold text-forest-900"
      >
        Upcoming events
      </h2>

      <ol className="mt-5 space-y-5">
        {EVENTS.map((event) => (
          <li key={event.id} className="flex gap-4">
            <div
              aria-hidden
              className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-md bg-forest-50 leading-none"
            >
              <span className="text-[0.65rem] tracking-wide text-forest-600 uppercase">
                {event.day}
              </span>
              <span className="mt-0.5 text-xs font-semibold text-forest-900">
                {event.date}
              </span>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink">{event.title}</p>
              <p className="text-xs text-muted">
                <time>
                  {event.day} {event.date}
                </time>
                {event.detail ? ` · ${event.detail}` : ""}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
