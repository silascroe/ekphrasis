import { parse } from "exifr";

const IDENTIFICATION_TAGS = [
  "XPTitle",
  "ImageDescription",
  "DocumentName",
  "Artist",
  "Copyright",
  "UserComment",
  "ObjectName",
  "Caption-Abstract",
  "Byline",
  "CopyrightNotice",
  "Keywords",
  "Title",
  "Description",
  "Creator",
  "Subject",
  "Rights"
];

export const IDENTIFICATION_METADATA_OPTIONS = {
  pick: IDENTIFICATION_TAGS,
  gps: false,
  xmp: true,
  iptc: true,
  userComment: true,
  makerNote: false,
  ifd1: false,
  mergeOutput: false,
  silentErrors: true
};

export async function readEmbeddedMetadata(file: Blob): Promise<unknown> {
  return parse(file, IDENTIFICATION_METADATA_OPTIONS);
}
