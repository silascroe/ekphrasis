import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { UploadForm } from "../../components/upload-form";

const uploadState = vi.hoisted(() => ({
  calls: [] as string[],
  context: {
    originalFilename: "painting.heic",
    originalMimeType: "image/heic",
    originalSize: 11_534_336,
    embedded: { title: "The original title" }
  }
}));

vi.mock("../../lib/image/upload-context", () => ({
  extractUploadContext: vi.fn(async () => {
    uploadState.calls.push("context");
    return uploadState.context;
  })
}));

vi.mock("../../lib/image/client", () => ({
  prepareUploadFile: vi.fn(async () => {
    uploadState.calls.push("prepare");
    return new File([new Uint8Array([1, 2, 3])], "painting.jpg", { type: "image/jpeg" });
  })
}));

class CapturedFormData {
  private readonly fields = new Map<string, unknown>();

  append(name: string, value: unknown): void {
    this.fields.set(name, value);
  }

  get(name: string): unknown {
    return this.fields.get(name) ?? null;
  }
}

describe("UploadForm submission", () => {
  beforeEach(() => uploadState.calls.splice(0));
  afterEach(() => vi.unstubAllGlobals());

  it("extracts original clues before compression and sends them beside the prepared image", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({
      json: async () => ({ state: "NO_MATCH" })
    } as Response));
    vi.stubGlobal("FormData", CapturedFormData);
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<UploadForm onResult={vi.fn()} />);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).toBeTruthy();
    const original = new File([new Uint8Array(11 * 1024 * 1024)], "painting.heic", { type: "image/heic" });

    fireEvent.change(input as HTMLInputElement, { target: { files: [original] } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    expect(uploadState.calls).toEqual(["context", "prepare"]);
    const body = fetchMock.mock.calls[0]?.[1]?.body as unknown as CapturedFormData;
    expect((body.get("image") as File).name).toBe("painting.jpg");
    expect(JSON.parse(String(body.get("context")))).toEqual(uploadState.context);
  });
});
