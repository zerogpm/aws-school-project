import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BookingForm from "./BookingForm";

async function submit(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /request this time/i }));
}

describe("BookingForm", () => {
  it("rejects a malformed student number before asking for anything else", async () => {
    const user = userEvent.setup();
    render(<BookingForm />);

    await user.type(screen.getByLabelText(/student number/i), "12345");
    await submit(user);

    expect(screen.getByRole("alert")).toHaveTextContent(/format S00481/i);
  });

  it("requires a slot once the student number is valid", async () => {
    const user = userEvent.setup();
    render(<BookingForm />);

    await user.type(screen.getByLabelText(/student number/i), "S00481");
    await submit(user);

    expect(screen.getByRole("alert")).toHaveTextContent(/choose a time slot/i);
  });

  it("accepts a valid student number and slot", async () => {
    const user = userEvent.setup();
    render(<BookingForm />);

    await user.type(screen.getByLabelText(/student number/i), "S00481");
    await user.click(screen.getByRole("radio", { name: /5:00 pm/i }));
    await submit(user);

    expect(screen.getByRole("alert")).toHaveTextContent(/episode 04/i);
  });

  it("does not let a full slot be selected", () => {
    render(<BookingForm />);

    // The 5:40 pm slot is full and offers the waitlist instead.
    expect(screen.getByRole("radio", { name: /5:40 pm/i })).toBeDisabled();
    expect(screen.getByText(/waitlist/i)).toBeInTheDocument();
  });

  it("shows no alert before the form is submitted", () => {
    render(<BookingForm />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
