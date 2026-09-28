import { beforeEach, describe, expect, it, vi } from "vitest";
import { parse } from "exifr";
import { canonicalUploadContext, extractUploadContext } from "../../lib/image/upload-context";

vi.mock("exifr", () => ({ parse: vi.fn() }));

const parseMock = vi.mocked(parse);

beforeEach(() => {
  parseMock.mockReset();
});

describe("extractUploadContext", () => {
  it("preserves the original filename, MIME type, and byte size", async () => {
    parseMock.mockResolvedValue(undefined);
    const file = new File([new Uint8Array([1, 2, 3])], "painting.heic", { type: "image/heic" });

    await expect(extractUploadContext(file)).resolves.toMatchObject({
      originalFilename: "painting.heic",
      originalMimeType: "image/heic",
      originalSize: 3
    });
  });

  it("forwards only whitelisted artwork metadata and disables GPS parsing", async () => {
    parseMock.mockResolvedValue({
      ifd0: {
        XPTitle: "The original title",
        ImageDescription: "A description",
        DocumentName: "catalogue-page-12",
        Make: "Camera maker",
        Model: "Camera model",
        GPSLatitude: 38.2
      },
      exif: {
        Artist: "A. Painter",
        Copyright: "Copyright A. Painter",
        UserComment: "Oil study",
        DateTimeOriginal: "2024:01:01 12:30:00",
        BodySerialNumber: "serial-123",
        OwnerName: "Private owner"
      },
      iptc: {
        ObjectName: "IPTC title",
        "Caption-Abstract": "IPTC caption",
        Byline: "IPTC artist",
        CopyrightNotice: "IPTC copyright",
        Keywords: ["portrait", "oil painting"],
        City: "Private location"
      },
      xmp: {
        dc: {
          title: "XMP title",
          description: "XMP description",
          creator: "XMP creator",
          rights: "XMP rights",
          subject: ["XMP subject"]
        },
        photoshop: { City: "Private XMP location" },
        exif: { DateTimeOriginal: "2024-01-01T12:30:00" }
      },
      UnknownProperty: "must not leak"
    });

    const file = new File([new Uint8Array([1])], "artwork.jpg", { type: "image/jpeg" });
    const context = await extractUploadContext(file);

    expect(context).toEqual({
      originalFilename: "artwork.jpg",
      originalMimeType: "image/jpeg",
      originalSize: 1,
      embedded: {
        title: "The original title",
        description: "A description",
        artist: "A. Painter",
        copyright: "Copyright A. Painter",
        subject: "portrait; oil painting",
        documentName: "catalogue-page-12",
        comment: "Oil study"
      }
    });
    expect(parseMock).toHaveBeenCalledWith(file, expect.objectContaining({
      gps: false,
      pick: expect.arrayContaining(["XPTitle", "ImageDescription", "Artist", "Copyright"])
    }));
  });

  it("returns the basic upload context when metadata parsing fails", async () => {
    parseMock.mockRejectedValue(new Error("unsupported metadata"));
    const file = new File([new Uint8Array([1, 2])], "unknown.png", { type: "image/png" });

    await expect(extractUploadContext(file)).resolves.toEqual({
      originalFilename: "unknown.png",
      originalMimeType: "image/png",
      originalSize: 2
    });
  });
});

describe("canonicalUploadContext", () => {
  it("is deterministic and excludes diagnostic file size", () => {
    const first = {
      originalFilename: "painting.jpg",
      originalMimeType: "image/jpeg",
      originalSize: 100,
      embedded: { artist: "A. Painter", title: "The Work" }
    };
    const second = {
      embedded: { title: "The Work", artist: "A. Painter" },
      originalSize: 500,
      originalMimeType: "image/jpeg",
      originalFilename: "painting.jpg"
    };

    expect(canonicalUploadContext(first)).toBe(canonicalUploadContext(second));
    expect(canonicalUploadContext(first)).not.toContain("originalSize");
    expect(canonicalUploadContext(first)).toContain("painting.jpg");
  });
});
