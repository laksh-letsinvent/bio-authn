import { readFileSync } from "fs";
import path from "path";
import { HardCopyActionClient } from "@/components/HardCopyActionClient";

export const dynamic = "force-static";

export default function HardCopyActionPage() {
  const raw = readFileSync(
    path.join(process.cwd(), "public", "data", "idv_examples.json"),
    "utf-8"
  );
  const examples = JSON.parse(raw);
  return <HardCopyActionClient examples={examples} />;
}
