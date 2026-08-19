import { ANNOUNCEMENTS } from "../data";

export default function Announcements() {
  return (
    <section aria-labelledby="announcements-heading">
      <div className="flex items-baseline justify-between gap-4">
        <h2
          id="announcements-heading"
          className="font-serif text-2xl font-semibold text-forest-900"
        >
          Latest news
        </h2>
        <p className="text-sm text-muted">Updated by the office</p>
      </div>

      <ol className="mt-6 divide-y divide-line border-t border-line">
        {ANNOUNCEMENTS.map((item) => (
          <li key={item.id} className="py-5">
            <article>
              <p className="text-xs tracking-wide text-muted uppercase">
                <time>{item.date}</time>
              </p>
              <h3 className="mt-1.5 font-serif text-lg font-semibold text-forest-900">
                {item.title}
              </h3>
              <p className="mt-1.5 text-sm text-muted">{item.body}</p>
            </article>
          </li>
        ))}
      </ol>
    </section>
  );
}
