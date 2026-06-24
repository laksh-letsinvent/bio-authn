import { readFileSync } from "fs";
import path from "path";
import { OverviewClient } from "@/components/OverviewClient";

export const dynamic = "force-static";

export default function OverviewPage() {
  const content = readFileSync(path.join(process.cwd(), "content", "OVERVIEW.md"), "utf-8");
  return <OverviewClient content={content} />;
}
