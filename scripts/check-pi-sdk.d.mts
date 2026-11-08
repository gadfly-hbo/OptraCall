export type PinnedSdkViolation = { file: string; line: number; reason: string };
export type PinnedSdkMaterials = {
  root: string;
  manifest: object;
  lock: object;
  packages: { directory: string; realDirectory: string; symlink: boolean; manifest: object }[];
  resolutions: { from: string; name: string; directory: string }[];
  patchFiles?: { file: string; source: string }[];
};
export function inspectPinnedSdkMaterials(materials: PinnedSdkMaterials): PinnedSdkViolation[];
export function checkPinnedSdk(root: string): Promise<PinnedSdkViolation[]>;
