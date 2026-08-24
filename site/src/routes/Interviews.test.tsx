import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import Interviews from "./Interviews";

// The notes are static copy, but the page mounts BookingForm, which asks for
// slots on mount. Stubbed so a test about wording does not fail on the network.
const stubSlots = () =>
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ windowId: "autumn-2026", slots: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );

beforeEach(() => {
  vi.restoreAllMocks();
  stubSlots();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the interview page's notes", () => {
  it("states the rules a parent needs before booking", () => {
    render(<Interviews />);

    expect(
      screen.getByText(/one slot per teacher per family/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/there is no waiting list/i)).toBeInTheDocument();
  });

  it("does not offer a waiting list, because the feature was cut", () => {
    // This page promised one for an episode and a half after the waitlist was
    // dropped - the copy outlived the feature once already. `.claude/rules/
    // data-model.md` keeps the design, marked as cut; this keeps the promise
    // from drifting back into the front end.
    render(<Interviews />);

    expect(screen.queryByText(/join the wait/i)).not.toBeInTheDocument();
  });
});
