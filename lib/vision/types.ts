import type { UploadContext } from "../image/upload-context";
import type { VisionDetection } from "../candidates/extract";

export type VisionInput = {
  image: Buffer;
  context?: UploadContext;
};

export interface VisionAdapter {
  detect(input: VisionInput): Promise<VisionDetection>;
}
