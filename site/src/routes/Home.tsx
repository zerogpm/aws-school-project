import { Link } from "react-router-dom";
import Announcements from "../components/Announcements";
import UpcomingEvents from "../components/UpcomingEvents";
import { FACTS } from "../data";

export default function Home() {
  return (
    <>
      <section className="border-b border-line bg-forest-50">
        <div className="mx-auto max-w-6xl px-6 py-20 sm:py-28">
          <p className="text-sm font-medium tracking-[0.18em] text-forest-600 uppercase">
            Halifax, Nova Scotia
          </p>
          <h1 className="mt-4 max-w-3xl font-serif text-4xl leading-tight font-bold text-forest-900 sm:text-6xl">
            A small school that takes the details seriously.
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-muted">
            Timetables, parent-teacher interviews, and everything families need
            &mdash; without an account, a login, or a phone call to the office.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link
              to="/interviews"
              className="rounded-md bg-forest-700 px-5 py-3 text-sm font-medium text-white transition hover:bg-forest-900"
            >
              Book a parent-teacher interview
            </Link>
            <Link
              to="/timetable"
              className="rounded-md border border-forest-600/40 px-5 py-3 text-sm font-medium text-forest-700 transition hover:bg-white"
            >
              View the timetable
            </Link>
          </div>
        </div>
      </section>

      <section className="border-b border-line">
        <dl className="mx-auto grid max-w-6xl grid-cols-2 gap-px bg-line sm:grid-cols-4">
          {FACTS.map((fact) => (
            <div key={fact.label} className="bg-paper px-6 py-8">
              <dt className="text-sm text-muted">{fact.label}</dt>
              <dd className="mt-1 font-serif text-3xl font-semibold text-forest-900">
                {fact.value}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="border-b border-line">
        <div className="mx-auto grid max-w-6xl gap-12 px-6 py-20 lg:grid-cols-[1.4fr_1fr]">
          <Announcements />
          <UpcomingEvents />
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="grid gap-12 lg:grid-cols-[1.2fr_1fr]">
          <div>
            <h2 className="font-serif text-3xl font-semibold text-forest-900">
              About the school
            </h2>
            <p className="mt-5 text-muted">
              Maplewood has served the same four neighbourhoods since 1962. We are
              deliberately small: every student is known by name by at least three
              adults in the building, and every family can reach a teacher without
              going through a switchboard.
            </p>
            <p className="mt-4 text-muted">
              This site is maintained by one teacher, in the time between classes.
              That constraint shapes it &mdash; everything here is either automatic
              or takes under a minute to update.
            </p>
          </div>

          <aside className="rounded-lg border border-line bg-white p-6">
            <h3 className="font-serif text-lg font-semibold text-forest-900">
              Office hours
            </h3>
            <ul className="mt-4 space-y-2.5 text-sm text-muted">
              <li className="flex justify-between gap-4">
                <span>Monday &ndash; Friday</span>
                <span className="text-ink">8:00 am &ndash; 4:00 pm</span>
              </li>
              <li className="flex justify-between gap-4">
                <span>Saturday &amp; Sunday</span>
                <span className="text-ink">Closed</span>
              </li>
            </ul>
            <hr className="my-5 border-line" />
            <p className="text-sm text-muted">
              1400 Maplewood Avenue
              <br />
              Halifax, NS B3H 2Y9
              <br />
              <span className="text-ink">(902) 555-0142</span>
            </p>
          </aside>
        </div>
      </section>
    </>
  );
}
