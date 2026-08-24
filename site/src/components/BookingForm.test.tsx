import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BookingForm from "./BookingForm";

// fetch is stubbed rather than the api module, so the component's real request
// shapes are under test too - a wrong URL or a missing Content-Type would pass
// a mocked module and fail against the wrapper.
const SLOTS = {
  windowId: "autumn-2026",
  label: "Autumn parent-teacher interviews",
  opensAt: "2026-10-14T21:00:00.000Z",
  closesAt: "2026-10-15T00:00:00.000Z",
  slots: [
    {
      slotId: "SLOT#2026-10-14T21:00:00.000Z#okafor",
      teacherName: "Ms. Okafor - Mathematics",
      startsAt: "2026-10-14T21:00:00.000Z",
      available: true,
    },
    {
      slotId: "SLOT#2026-10-14T21:20:00.000Z#levesque",
      teacherName: "Mr. Levesque - Science",
      startsAt: "2026-10-14T21:20:00.000Z",
      available: false,
    },
  ],
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes("/slots")) return json(200, SLOTS);
    return json(201, {
      bookingRef: "3f1c8a2e-0000-4000-8000-000000000000",
      windowId: "autumn-2026",
      slotId: SLOTS.slots[0].slotId,
      startsAt: SLOTS.slots[0].startsAt,
      teacherId: "okafor",
      studentNumber: "S00481",
    });
  });

  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The times render asynchronously, so every test waits for the first one. */
async function ready() {
  await waitFor(() => expect(screen.getByRole("radio", { name: /Okafor/i })).toBeInTheDocument());
}

async function submit(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /request this time/i }));
}

describe("BookingForm", () => {
  it("lists the times the API returns, not a fixture", async () => {
    render(<BookingForm />);
    await ready();

    expect(fetchMock.mock.calls[0][0]).toContain("/windows/autumn-2026/slots");
    expect(screen.getByRole("radio", { name: /Levesque/i })).toBeInTheDocument();
  });

  it("disables a slot somebody already holds", async () => {
    render(<BookingForm />);
    await ready();

    // Availability is computed from the item, not a hardcoded flag.
    expect(screen.getByRole("radio", { name: /Okafor/i })).toBeEnabled();
    expect(screen.getByRole("radio", { name: /Levesque/i })).toBeDisabled();
    expect(screen.getByText("Booked")).toBeInTheDocument();
  });

  it("rejects a malformed student number before asking the API for anything", async () => {
    const user = userEvent.setup();
    render(<BookingForm />);
    await ready();

    await user.type(screen.getByLabelText(/student number/i), "12345");
    await submit(user);

    expect(screen.getByRole("alert")).toHaveTextContent(/format S00481/i);
    // Only the slot list was fetched; no booking was attempted.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("requires a slot once the student number is valid", async () => {
    const user = userEvent.setup();
    render(<BookingForm />);
    await ready();

    await user.type(screen.getByLabelText(/student number/i), "S00481");
    await submit(user);

    expect(screen.getByRole("alert")).toHaveTextContent(/choose a time slot/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("posts the booking and shows the reference needed to cancel", async () => {
    const user = userEvent.setup();
    render(<BookingForm />);
    await ready();

    await user.type(screen.getByLabelText(/student number/i), "S00481");
    await user.click(screen.getByRole("radio", { name: /Okafor/i }));
    await submit(user);

    await waitFor(() =>
      expect(screen.getByText(/3f1c8a2e-0000-4000-8000-000000000000/)).toBeInTheDocument(),
    );

    const [url, init] = fetchMock.mock.calls[1];
    expect(String(url)).toContain("/bookings");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      studentNumber: "S00481",
      windowId: "autumn-2026",
      slotId: SLOTS.slots[0].slotId,
    });
  });

  it("shows the server's own message when the slot was just taken", async () => {
    // The whole point of mapping CancellationReasons: a parent is told which
    // of four things went wrong, in words they can act on.
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes("/slots")) return json(200, SLOTS);
      return json(409, { error: "That time was just taken - please choose another" });
    });

    const user = userEvent.setup();
    render(<BookingForm />);
    await ready();

    await user.type(screen.getByLabelText(/student number/i), "S00481");
    await user.click(screen.getByRole("radio", { name: /Okafor/i }));
    await submit(user);

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/just taken/i));
  });

  it("reloads the times after losing a race, so the next choice is against reality", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes("/slots")) return json(200, SLOTS);
      return json(409, { error: "That time was just taken - please choose another" });
    });

    const user = userEvent.setup();
    render(<BookingForm />);
    await ready();

    await user.type(screen.getByLabelText(/student number/i), "S00481");
    await user.click(screen.getByRole("radio", { name: /Okafor/i }));
    await submit(user);

    // The initial load, the failed POST, and a refetch of the list.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(String(fetchMock.mock.calls[2][0])).toContain("/slots");
  });

  it("does not reload the times after a typo, which would wipe the form", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes("/slots")) return json(200, SLOTS);
      return json(404, { error: "No student with that number" });
    });

    const user = userEvent.setup();
    render(<BookingForm />);
    await ready();

    await user.type(screen.getByLabelText(/student number/i), "S00481");
    await user.click(screen.getByRole("radio", { name: /Okafor/i }));
    await submit(user);

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/No student with that number/i),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("explains itself when the API cannot be reached", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    render(<BookingForm />);

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/Could not reach the booking service/i),
    );
  });

  it("says booking is not open when the window is unpublished", async () => {
    fetchMock.mockResolvedValue(json(404, { error: "No such interview window" }));

    render(<BookingForm />);

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/not open yet/i),
    );
  });

  it("cancels from the confirmation, and offers the freed time again", async () => {
    // "Change my time" is cancel-then-book. The reference and the student
    // number are both already known here, so the parent types nothing.
    const user = userEvent.setup();
    render(<BookingForm />);
    await ready();

    await user.type(screen.getByLabelText(/student number/i), "S00481");
    await user.click(screen.getByRole("radio", { name: /Okafor/i }));
    await submit(user);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /cancel this time/i })).toBeInTheDocument(),
    );

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes("/slots")) return json(200, SLOTS);
      return json(200, { bookingRef: "3f1c8a2e-0000-4000-8000-000000000000", cancelled: true });
    });

    await user.click(screen.getByRole("button", { name: /cancel this time/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/given up. Choose another/i),
    );

    const cancelCall = fetchMock.mock.calls.find(
      (call) => call[1]?.method === "DELETE",
    )!;
    expect(String(cancelCall[0])).toContain("/bookings/3f1c8a2e-0000-4000-8000-000000000000");
    expect(JSON.parse(cancelCall[1].body)).toEqual({ studentNumber: "S00481" });

    // And the list is back, so a new time can be chosen straight away.
    await waitFor(() =>
      expect(screen.getByRole("radio", { name: /Okafor/i })).toBeInTheDocument(),
    );
  });

  it("narrows the list to one teacher, and drops the teacher line once it is redundant", async () => {
    // Thirty-six rows sorted by time repeat each time once per teacher. One
    // teacher at a time is nine rows, and their name no longer needs repeating
    // under every one.
    const user = userEvent.setup();
    render(<BookingForm />);
    await ready();

    expect(screen.getAllByRole("radio")).toHaveLength(2);

    // Twice: the <option> in the picker, and the line under this teacher's row.
    expect(screen.getAllByText("Ms. Okafor - Mathematics")).toHaveLength(2);

    await user.selectOptions(screen.getByLabelText(/teacher/i), "Ms. Okafor - Mathematics");

    expect(screen.getAllByRole("radio")).toHaveLength(1);

    // Once now: only the <option>. Repeating the name under every row of that
    // teacher's own list is the noise this removes.
    expect(screen.getAllByText("Ms. Okafor - Mathematics")).toHaveLength(1);
    expect(screen.getAllByText("Mr. Levesque - Science")).toHaveLength(1);
  });

  it("forgets a chosen slot when the teacher changes", async () => {
    // The slot belonged to the previous teacher; leaving it selected would let
    // a parent submit a time they can no longer see.
    const user = userEvent.setup();
    render(<BookingForm />);
    await ready();

    await user.click(screen.getByRole("radio", { name: /Okafor/i }));
    await user.selectOptions(screen.getByLabelText(/teacher/i), "Mr. Levesque - Science");
    await user.type(screen.getByLabelText(/student number/i), "S00481");
    await submit(user);

    expect(screen.getByRole("alert")).toHaveTextContent(/choose a time slot/i);
  });

  it("counts what is actually free", async () => {
    render(<BookingForm />);
    await ready();

    // One of the two fixtures is already booked.
    expect(screen.getByText(/1 of 2 times free/i)).toBeInTheDocument();
  });

  describe("paging through the times", () => {
    // Fifteen slots for one teacher: three pages of six, five, and four.
    const many = {
      ...SLOTS,
      slots: Array.from({ length: 15 }, (_, index) => ({
        slotId: `SLOT#2026-10-14T${21 + Math.floor(index / 3)}:${(index % 3) * 20}0:00.000Z#okafor`,
        teacherName: "Ms. Okafor - Mathematics",
        startsAt: new Date(Date.UTC(2026, 9, 14, 21, index * 20)).toISOString(),
        available: index !== 0,
      })),
    };

    const withMany = () => {
      fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
        if (String(input).includes("/slots")) return json(200, many);
        return json(201, {
          bookingRef: "3f1c8a2e-0000-4000-8000-000000000000",
          windowId: "autumn-2026",
          slotId: many.slots[1].slotId,
          startsAt: many.slots[1].startsAt,
          teacherId: "okafor",
          studentNumber: "S00481",
        });
      });
    };

    it("shows one page at a time instead of one long list", async () => {
      withMany();
      render(<BookingForm />);

      await waitFor(() => expect(screen.getAllByRole("radio").length).toBeGreaterThan(0));

      expect(screen.getAllByRole("radio")).toHaveLength(6);
      expect(screen.getByText(/Page 1 of 3/i)).toBeInTheDocument();
      // The count is of everything, not of this page - it is what tells a
      // parent whether paging on is worth it.
      expect(screen.getByText(/14 of 15 times free/i)).toBeInTheDocument();
    });

    it("pages forward and back, and stops at each end", async () => {
      withMany();
      const user = userEvent.setup();
      render(<BookingForm />);
      await waitFor(() => expect(screen.getAllByRole("radio").length).toBeGreaterThan(0));

      expect(screen.getByRole("button", { name: /earlier/i })).toBeDisabled();

      await user.click(screen.getByRole("button", { name: /later/i }));
      expect(screen.getByText(/Page 2 of 3/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /earlier/i })).toBeEnabled();

      await user.click(screen.getByRole("button", { name: /later/i }));
      expect(screen.getByText(/Page 3 of 3/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /later/i })).toBeDisabled();
      // Three left over on the last page.
      expect(screen.getAllByRole("radio")).toHaveLength(3);

      await user.click(screen.getByRole("button", { name: /earlier/i }));
      expect(screen.getByText(/Page 2 of 3/i)).toBeInTheDocument();
    });

    it("keeps a slot chosen on another page, and says which", async () => {
      // Paging must not silently drop the selection - the submit button would
      // then look like it does nothing.
      withMany();
      const user = userEvent.setup();
      render(<BookingForm />);
      await waitFor(() => expect(screen.getAllByRole("radio").length).toBeGreaterThan(0));

      await user.click(screen.getAllByRole("radio")[1]);
      await user.click(screen.getByRole("button", { name: /later/i }));

      expect(screen.getByText(/^Chosen:/)).toBeInTheDocument();

      await user.type(screen.getByLabelText(/student number/i), "S00481");
      await submit(user);

      await waitFor(() =>
        expect(screen.getByText(/3f1c8a2e-0000-4000-8000-000000000000/)).toBeInTheDocument(),
      );
    });

    it("goes back to the first page when the teacher changes", async () => {
      withMany();
      const user = userEvent.setup();
      render(<BookingForm />);
      await waitFor(() => expect(screen.getAllByRole("radio").length).toBeGreaterThan(0));

      await user.click(screen.getByRole("button", { name: /later/i }));
      expect(screen.getByText(/Page 2 of 3/i)).toBeInTheDocument();

      await user.selectOptions(screen.getByLabelText(/teacher/i), "Ms. Okafor - Mathematics");

      // Page two of the old list is not page two of the new one.
      expect(screen.getByText(/Page 1 of 3/i)).toBeInTheDocument();
    });

    it("hides the controls when everything fits on one page", async () => {
      render(<BookingForm />);
      await ready();

      expect(screen.queryByRole("button", { name: /later/i })).not.toBeInTheDocument();
    });
  });

  it("offers another teacher for the same child, keeping the student number", async () => {
    // The common case, and the one the first cut had no route through: one
    // child, several teachers on the same evening.
    const user = userEvent.setup();
    render(<BookingForm />);
    await ready();

    await user.type(screen.getByLabelText(/student number/i), "S00481");
    await user.click(screen.getByRole("radio", { name: /Okafor/i }));
    await submit(user);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /book another teacher/i })).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: /book another teacher/i }));

    // Back to the list with the number still filled in - a parent booking four
    // teachers should not type it four times.
    expect(screen.getByLabelText(/student number/i)).toHaveValue("S00481");
    expect(screen.getAllByRole("radio").length).toBeGreaterThan(0);
  });

  it("clears the child when booking for a different one", async () => {
    const user = userEvent.setup();
    render(<BookingForm />);
    await ready();

    await user.type(screen.getByLabelText(/student number/i), "S00481");
    await user.click(screen.getByRole("radio", { name: /Okafor/i }));
    await submit(user);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /another child/i })).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: /another child/i }));

    expect(screen.getByLabelText(/student number/i)).toHaveValue("");
  });

  it("passes the time-conflict refusal through", async () => {
    // Two teachers at the same hour is one parent in two rooms. The guard is in
    // the transaction; the form's job is to say which of the four things failed.
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes("/slots")) return json(200, SLOTS);
      return json(409, { error: "You already have an interview at that time" });
    });

    const user = userEvent.setup();
    render(<BookingForm />);
    await ready();

    await user.type(screen.getByLabelText(/student number/i), "S00481");
    await user.click(screen.getByRole("radio", { name: /Okafor/i }));
    await submit(user);

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/already have an interview at that time/i),
    );
  });

  it("marks a slot another family holds as Booked, and strikes the time through", async () => {
    render(<BookingForm />);
    await ready();

    const taken = screen.getByRole("radio", { name: /Levesque/i });
    expect(taken).toBeDisabled();

    const badge = screen.getByText("Booked");
    expect(badge).toBeInTheDocument();

    // The time itself is struck through, so the row reads as unavailable at a
    // glance rather than only via the small badge on the right.
    const row = taken.closest("label")!;
    expect(row.querySelector(".line-through")).not.toBeNull();
  });

  it("distinguishes this family's own booking from another family's", async () => {
    // Both are unbookable; only one is good news. Showing them identically
    // makes a parent think they lost a slot they actually hold.
    const user = userEvent.setup();

    // After the booking lands, the slot list reports it taken - which is what
    // the real reload returns, since this family just took it.
    let booked = false;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes("/slots")) {
        return json(200, {
          ...SLOTS,
          slots: [{ ...SLOTS.slots[0], available: !booked }, SLOTS.slots[1]],
        });
      }
      booked = true;
      return json(201, {
        bookingRef: "3f1c8a2e-0000-4000-8000-000000000000",
        windowId: "autumn-2026",
        slotId: SLOTS.slots[0].slotId,
        startsAt: SLOTS.slots[0].startsAt,
        teacherId: "okafor",
        studentNumber: "S00481",
      });
    });

    render(<BookingForm />);
    await ready();

    await user.type(screen.getByLabelText(/student number/i), "S00481");
    await user.click(screen.getByRole("radio", { name: /Okafor/i }));
    await submit(user);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /book another teacher/i })).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: /book another teacher/i }));

    await waitFor(() => expect(screen.getByText("Your booking")).toBeInTheDocument());
    // The other family's slot is still just "Booked".
    expect(screen.getByText("Booked")).toBeInTheDocument();
  });

  it("shows no alert before the form is submitted", async () => {
    render(<BookingForm />);
    await ready();

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
