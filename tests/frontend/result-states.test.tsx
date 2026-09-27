import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Home } from "../../components/home";

afterEach(() => cleanup());

describe("result states", () => {
  it("shows the processing copy without provider-specific stages", () => {
    render(<Home initialState="PROCESSING" />);
    expect(screen.getByText("Identifying your artwork…")).toBeTruthy();
    expect(screen.queryByText(/searching museums/i)).toBeNull();
  });

  it("shows related reading when supplied", () => {
    render(<Home initialState="MATCH" result={{
      state: "MATCH",
      confidence: "medium",
      artwork: { title: "Example", artist: "Artist", year: "1900", medium: "Oil on canvas", style: null },
      source: { id: "met", name: "The Met", image_url: null, url: null },
      context: null,
      detail: null,
      related_reading: [{ title: "Example.org", url: "https://example.org/reading" }],
      degraded: false,
      unavailable_sources: []
    }} />);
    expect(screen.getByRole("link", { name: "Example.org" })).toBeTruthy();
  });

  it("shows title and provenance fields and hides style when absent", () => {
    render(<Home initialState="MATCH" result={{
      state: "MATCH",
      confidence: "high",
      artwork: { title: "Example", artist: "Artist", year: "1900", medium: "Oil on canvas", style: null },
      source: { id: "met", name: "The Met", image_url: "https://example.com/art.jpg", url: "https://example.com" },
      context: "Context.",
      detail: "Detail.",
      related_reading: [],
      degraded: false,
      unavailable_sources: []
    }} />);
    expect(screen.getByRole("heading", { name: "Example" })).toBeTruthy();
    expect(screen.getAllByText("Artist")[0]).toBeTruthy();
    expect(screen.getByText(/1900/)).toBeTruthy();
    expect(screen.getByText(/Oil on canvas/)).toBeTruthy();
    expect(screen.queryByText("Style")).toBeNull();
  });

  it("lets users start over after a terminal result", () => {
    render(<Home initialState="NO_MATCH" result={{
      state: "NO_MATCH",
      reason: "insufficient_evidence",
      degraded: false,
      unavailable_sources: []
    }} />);

    fireEvent.click(screen.getByRole("button", { name: /try another photo/i }));
    expect(screen.getByRole("button", { name: /choose a photo/i })).toBeTruthy();
  });
});
