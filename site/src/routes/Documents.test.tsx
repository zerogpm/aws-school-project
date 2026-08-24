import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Documents from "./Documents";

const DOC = {
  id: "11111111-1111-4111-8111-111111111111",
  key: "docs/11111111-1111-4111-8111-111111111111/Year Calendar.pdf",
  filename: "Year Calendar.pdf",
  url: "https://cdn.test/docs/11111111-1111-4111-8111-111111111111/Year%20Calendar.pdf",
  bytes: 162_000,
  updatedAt: "2026-08-24T03:26:38.000Z",
};

const respondWith = (documents: unknown[], status = 200) =>
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ documents }), { status }),
  );

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const renderPage = () =>
  render(
    <MemoryRouter>
      <Documents />
    </MemoryRouter>,
  );

describe("the public documents page", () => {
  it("asks for the list without an Authorization header", async () => {
    // The route is public on purpose - there are no parent accounts. Sending a
    // header here would be the first step towards it quietly needing one.
    const fetchSpy = respondWith([DOC]);

    renderPage();
    await screen.findByRole("link", { name: /view year calendar\.pdf/i });

    const [, init] = fetchSpy.mock.calls[0];
    expect((init?.headers ?? {}) as Record<string, string>).not.toHaveProperty("Authorization");
  });

  it("links to the URL the API built, not one assembled here", async () => {
    // The bucket is private behind OAC, so only the CloudFront URL works. If
    // the front end ever starts building this itself, the docs/ prefix lives in
    // two places and one of them will be wrong.
    respondWith([DOC]);

    renderPage();

    const view = await screen.findByRole("link", { name: /view year calendar\.pdf/i });
    expect(view).toHaveAttribute("href", DOC.url);
  });

  it("offers a download that saves under the real filename", async () => {
    respondWith([DOC]);

    renderPage();

    const download = await screen.findByRole("link", { name: /download year calendar\.pdf/i });
    // Same-origin only, which is exactly what CloudFront serving both the site
    // and the documents buys.
    expect(download).toHaveAttribute("download", "Year Calendar.pdf");
    expect(download).toHaveAttribute("href", DOC.url);
  });

  it("opens a view in a new tab without handing it a window.opener", async () => {
    respondWith([DOC]);

    renderPage();

    const view = await screen.findByRole("link", { name: /view year calendar\.pdf/i });
    expect(view).toHaveAttribute("target", "_blank");
    expect(view).toHaveAttribute("rel", "noreferrer");
  });

  it("shows the size, so a parent on mobile data knows what they are opening", async () => {
    respondWith([DOC]);

    renderPage();

    expect(await screen.findByText(/158 KB/)).toBeInTheDocument();
  });

  it("says so when nothing has been published", async () => {
    respondWith([]);

    renderPage();

    expect(await screen.findByText(/nothing has been published yet/i)).toBeInTheDocument();
  });

  it("explains a failure rather than showing an empty list as though it were empty", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));

    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not reach/i);
  });
});
