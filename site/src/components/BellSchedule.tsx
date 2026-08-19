import { BELL_SCHEDULE } from "../data";

export default function BellSchedule() {
  return (
    <section aria-labelledby="bells-heading">
      <h2
        id="bells-heading"
        className="font-serif text-2xl font-semibold text-forest-900"
      >
        Bell schedule
      </h2>
      <p className="mt-2 text-muted">
        Late-start mornings run on assembly and professional development days.
      </p>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[28rem] border-collapse text-left text-sm">
          <caption className="sr-only">
            Bell times for regular and late-start days
          </caption>
          <thead>
            <tr className="border-b border-line text-muted">
              <th scope="col" className="py-3 pr-4 font-medium">
                Bell
              </th>
              <th scope="col" className="py-3 pr-4 font-medium">
                Regular day
              </th>
              <th scope="col" className="py-3 font-medium">
                Late start
              </th>
            </tr>
          </thead>
          <tbody>
            {BELL_SCHEDULE.map((row) => (
              <tr key={row.label} className="border-b border-line/70 text-ink">
                <th scope="row" className="py-3 pr-4 text-left font-medium">
                  {row.label}
                </th>
                <td className="py-3 pr-4 whitespace-nowrap">{row.regular}</td>
                <td className="py-3 whitespace-nowrap text-muted">
                  {row.lateStart}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
