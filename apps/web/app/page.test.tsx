import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import Home from "./page";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Home", () => {
  it("shows the API status once the health check resolves", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: "ok" }),
      }),
    );

    render(await Home());

    expect(screen.getByRole("heading", { name: "IBMS" })).toBeInTheDocument();
    expect(screen.getByText("definitely not the api status")).toBeInTheDocument();
  });

  it("falls back to 'unreachable' when the API call fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));

    render(await Home());

    expect(screen.getByText("unreachable")).toBeInTheDocument();
  });
});
