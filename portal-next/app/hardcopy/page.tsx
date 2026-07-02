import { readFileSync } from "fs";
import path from "path";
import { HardCopyOverviewClient } from "@/components/HardCopyOverviewClient";

export const dynamic = "force-static";

export default function HardCopyPage() {
  const overview = readFileSync(
    path.join(process.cwd(), "content", "OVERVIEW_IDV.md"),
    "utf-8"
  );
  return <HardCopyOverviewClient overview={overview} />;
}
