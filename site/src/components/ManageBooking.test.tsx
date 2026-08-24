import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ManageBooking from "./ManageBooking";

const REF = "459e875f-19f8-4378-afb1-26b614c1a7f3";
const OTHER = "9a2b1c3d-0000-4000-9000-000000000001";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const BOOKINGS = [
  {
    bookingRef: REF,
    slotId: "SLOT#2026-10-14T21:00:00.000Z#okafor",
    teacherName: "Ms. Okafor - Mathematics",
    startsAt: "2026-10-14T21:00:00.000Z",
  },
  {
    bookingRef: OTHER,
    slotId: "SLOT#2026-10-14T21:40:00.000Z#levesque",
    teacherName: "Mr. Levesque - Science",
    startsAt: "2026-10-14T21:40:00.000Z",
  },
];

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes("/lookup")) return json(200, { bookings: BOOKINGS });
    return json(200, { bookingRef: REF, cancelled: true });
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const lookUp = async (
  user: ReturnType<typeof userEvent.setup>,
  ref = REF,
  student = "S00481",
) => {
  if (ref) await user.type(screen.getByLabelText(/booking reference/i), ref);
  if (student) await user.type(screen.getByLabelText(/student number/i), student);
  await user.click(screen.getByRole("button", { name: /find my bookings/i }));
};

describe("ManageBooking", () => {
  it("finds the whole evening from one reference, so a choice is possible", async () => {
    // The gap this replaces: a family with three bookings and one surviving
    // confirmation could only ever cancel that one.
    const user = userEvent.setup();
    render(<ManageBooking />);

    await lookUp(user);

    await waitFor(() => expect(screen.getByText(/Ms\. Okafor/)).toBeInTheDocument());
    expect(screen.getByText(/Mr\. Levesque/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^cancel$/i })).toHaveLength(2);
  });

  it("sends both halves of the credential", async () => {
    const user = userEvent.setup();
    render(<ManageBooking />);

    await lookUp(user);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/bookings/lookup");
    // POST, not GET: the reference is a credential and does not belong in a URL
    // or an access log.
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ bookingRef: REF, studentNumber: "S00481" });
  });

  it("cancels only the one chosen, leaving the other", async () => {
    const user = userEvent.setup();
    render(<ManageBooking />);
    await lookUp(user);
    await waitFor(() => expect(screen.getByText(/Ms\. Okafor/)).toBeInTheDocument());

    // The first row is Okafor at 5:00.
    await user.click(screen.getAllByRole("button", { name: /^cancel$/i })[0]);

    await waitFor(() => expect(screen.queryByText(/Ms\. Okafor/)).not.toBeInTheDocument());
    expect(screen.getByText(/Mr\. Levesque/)).toBeInTheDocument();

    const cancelCall = fetchMock.mock.calls.find((call) => call[1]?.method === "DELETE")!;
    expect(String(cancelCall[0])).toContain(REF);
    expect(String(cancelCall[0])).not.toContain(OTHER);
  });

  it("says which time was given up", async () => {
    const user = userEvent.setup();
    render(<ManageBooking />);
    await lookUp(user);
    await waitFor(() => expect(screen.getByText(/Ms\. Okafor/)).toBeInTheDocument());

    await user.click(screen.getAllByRole("button", { name: /^cancel$/i })[0]);

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(/5:00 p\.?m\.?.*given up/i),
    );
  });

  it("refuses a student number with no reference, which is the guessing attack", async () => {
    const user = userEvent.setup();
    render(<ManageBooking />);

    await lookUp(user, "", "S00481");

    expect(screen.getByRole("alert")).toHaveTextContent(/Enter the reference/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed student number before asking", async () => {
    const user = userEvent.setup();
    render(<ManageBooking />);

    await lookUp(user, REF, "12345");

    expect(screen.getByRole("alert")).toHaveTextContent(/format S00481/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes the server's refusal through when the pair does not match", async () => {
    fetchMock.mockResolvedValue(
      json(403, { error: "That student number does not match this booking" }),
    );

    const user = userEvent.setup();
    render(<ManageBooking />);
    await lookUp(user, REF, "S00482");

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/does not match this booking/i),
    );
  });

  it("says so when the reference is not a booking", async () => {
    fetchMock.mockResolvedValue(json(404, { error: "No booking with that reference" }));

    const user = userEvent.setup();
    render(<ManageBooking />);
    await lookUp(user);

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/No booking with that reference/i),
    );
  });

  it("handles a reference whose booking was already cancelled", async () => {
    fetchMock.mockImplementation(async () => json(200, { bookings: [] }));

    const user = userEvent.setup();
    render(<ManageBooking />);
    await lookUp(user);

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/already been cancelled/i),
    );
  });

  it("explains itself when the API cannot be reached", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    const user = userEvent.setup();
    render(<ManageBooking />);
    await lookUp(user);

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/Could not reach the booking service/i),
    );
  });

  it("shows no alert before anything is submitted", () => {
    render(<ManageBooking />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
