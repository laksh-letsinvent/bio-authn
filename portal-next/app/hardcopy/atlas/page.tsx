import { readFileSync } from "fs";
import path from "path";
import { HardCopyAtlasClient } from "@/components/HardCopyAtlasClient";

export const dynamic = "force-static";

export default function HardCopyAtlasPage() {
  const atlas = readFileSync(path.join(process.cwd(), "content", "ATLAS_IDV.md"), "utf-8");
  return <HardCopyAtlasClient atlas={atlas} />;
}
