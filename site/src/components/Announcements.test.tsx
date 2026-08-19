import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import Announcements from "./Announcements";
import UpcomingEvents from "./UpcomingEvents";
import BellSchedule from "./BellSchedule";
import { ANNOUNCEMENTS, BELL_SCHEDULE, EVENTS } from "../data";

describe("Announcements", () => {
  it("renders every announcement as a list item", () => {
    render(<Announcements />);
    const items = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(items).toHaveLength(ANNOUNCEMENTS.length);
  });

  it("shows the newest announcement first", () => {
    render(<Announcements />);
    const headings = screen.getAllByRole("heading", { level: 3 });
    expect(headings[0]).toHaveTextContent(ANNOUNCEMENTS[0].title);
  });

  it("gives each announcement a date and a body", () => {
    render(<Announcements />);
    for (const item of ANNOUNCEMENTS) {
      expect(screen.getByText(item.title)).toBeInTheDocument();
      expect(screen.getByText(item.body)).toBeInTheDocument();
    }
  });

  it("is labelled for assistive technology", () => {
    render(<Announcements />);
    expect(
      screen.getByRole("region", { name: /latest news/i }),
    ).toBeInTheDocument();
  });
});

describe("UpcomingEvents", () => {
  it("renders every event", () => {
    render(<UpcomingEvents />);
    expect(within(screen.getByRole("list")).getAllByRole("listitem")).toHaveLength(
      EVENTS.length,
    );
  });

  it("shows the title and detail for an event that has one", () => {
    render(<UpcomingEvents />);
    expect(screen.getByText("Parent-teacher interviews")).toBeInTheDocument();
    expect(screen.getByText(/5:00 - 8:00 pm/)).toBeInTheDocument();
  });

  it("renders an event without a detail without printing a stray separator", () => {
    render(<UpcomingEvents />);
    const firstDay = screen.getByText("First day of classes");
    const meta = firstDay.parentElement?.textContent ?? "";
    expect(meta).not.toContain("·");
  });
});

describe("BellSchedule", () => {
  it("lists every bell with a regular and a late-start time", () => {
    render(<BellSchedule />);
    for (const row of BELL_SCHEDULE) {
      const cell = screen.getByRole("rowheader", { name: row.label });
      const times = within(cell.closest("tr")!).getAllByRole("cell");
      expect(times).toHaveLength(2);
      expect(times[0]).toHaveTextContent(row.regular);
      expect(times[1]).toHaveTextContent(row.lateStart);
    }
  });

  it("distinguishes the two day types in the header", () => {
    render(<BellSchedule />);
    expect(screen.getByRole("columnheader", { name: /regular day/i })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /late start/i })).toBeInTheDocument();
  });
});
