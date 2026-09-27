import { describe, expect, it, vi } from "vitest";
import { HuggingFaceVisionAdapter } from "./huggingface";

describe("HuggingFaceVisionAdapter", () => {
  it("turns structured VLM output into search candidates", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ artist: "Johannes Vermeer", title: "Girl with a Pearl Earring", year: "1665", medium: "oil on canvas", candidates: [{ text: "Johannes Vermeer" }, { text: "Girl with a Pearl Earring" }] }) } }]
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const result = await new HuggingFaceVisionAdapter("hf_test").detect(Buffer.from("image"));
    expect(result.webDetection?.webEntities?.map(item => item.description)).toEqual(["Johannes Vermeer", "Girl with a Pearl Earring", "1665", "oil on canvas"]);
    expect(result.extracted).toEqual({
      artist: "Johannes Vermeer",
      title: "Girl with a Pearl Earring",
      year: "1665",
      medium: "oil on canvas"
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    fetchMock.mockRestore();
  });

  it("fails clearly when the token is missing", async () => {
    await expect(new HuggingFaceVisionAdapter("").detect(Buffer.from("image"))).rejects.toMatchObject({ provider: "vision", failure: "AUTH" });
  });

  it("allows enough time for Hugging Face vision cold starts", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ candidates: [{ text: "Girl with a Pearl Earring" }] }) } }]
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const timeoutMock = vi.spyOn(AbortSignal, "timeout");
    await new HuggingFaceVisionAdapter("hf_test").detect(Buffer.from("image"));
    expect(timeoutMock).toHaveBeenCalledWith(30000);
    fetchMock.mockRestore();
    timeoutMock.mockRestore();
  });

  it("emits boundary diagnostics without exposing the token", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ candidates: [{ text: "Girl with a Pearl Earring" }] }) } }]
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const log = vi.fn();
    await new HuggingFaceVisionAdapter("hf_secret", log).detect(Buffer.from("image"));
    expect(log).toHaveBeenCalledWith("vision.start", expect.objectContaining({ model: expect.any(String), bytes: 5 }));
    expect(log).toHaveBeenCalledWith("vision.response", expect.objectContaining({ status: 200, elapsedMs: expect.any(Number) }));
    expect(log.mock.calls.flat().join(" ")).not.toContain("hf_secret");
    fetchMock.mockRestore();
  });

  it("logs a bounded provider error message for failed upstream responses", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Model is unavailable for routed inference" }), {
        status: 503,
        headers: { "Content-Type": "application/json" }
      })
    );
    const log = vi.fn();

    await expect(new HuggingFaceVisionAdapter("hf_secret", log).detect(Buffer.from("image")))
      .rejects.toMatchObject({ provider: "vision", failure: "PROVIDER_ERROR" });

    expect(log).toHaveBeenCalledWith("vision.response", expect.objectContaining({
      status: 503,
      providerMessage: "Model is unavailable for routed inference"
    }));
    expect(log.mock.calls.flat().join(" ")).not.toContain("hf_secret");
    fetchMock.mockRestore();
  });
});
