import BellSchedule from "../components/BellSchedule";
import { TIMETABLE } from "../data";

export default function Timetable() {
  return (
    <section className="bg-white">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-serif text-3xl font-semibold text-forest-900">
              Published timetable
            </h1>
            <p className="mt-2 text-muted">
              Semester 1 &middot; Grade 11 &middot; effective 8 September
            </p>
          </div>
          <p className="text-sm text-muted">
            Last published by staff on 2 September
          </p>
        </div>

        <div className="mt-8 overflow-x-auto">
          <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
            <caption className="sr-only">
              Grade 11 semester 1 timetable, by period and day
            </caption>
            <thead>
              <tr className="border-b border-line text-muted">
                <th scope="col" className="py-3 pr-4 font-medium">
                  Period
                </th>
                <th scope="col" className="py-3 pr-4 font-medium">
                  Time
                </th>
                <th scope="col" className="py-3 pr-4 font-medium">
                  Day A
                </th>
                <th scope="col" className="py-3 font-medium">
                  Day B
                </th>
              </tr>
            </thead>
            <tbody>
              {TIMETABLE.map((row) => (
                <tr
                  key={row.time}
                  className={`border-b border-line/70 ${
                    row.isBreak ? "text-muted" : "text-ink"
                  }`}
                >
                  <td className="py-3.5 pr-4 font-medium">{row.period}</td>
                  <td className="py-3.5 pr-4 whitespace-nowrap">{row.time}</td>
                  <td className="py-3.5 pr-4">{row.dayA}</td>
                  <td className="py-3.5">{row.dayB}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <hr className="my-16 border-line" />

        <BellSchedule />
      </div>
    </section>
  );
}
