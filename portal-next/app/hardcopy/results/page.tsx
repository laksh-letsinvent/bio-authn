import { readFileSync } from "fs";
import path from "path";
import { HardCopyResultsClient } from "@/components/HardCopyResultsClient";

export const dynamic = "force-static";

export default function HardCopyResultsPage() {
  let idvRun: object | null = null;
  let idvRunV15: object | null = null;
  try {
    const raw = readFileSync(path.join(process.cwd(), "..", "results", "idv_run.json"), "utf-8");
    idvRun = JSON.parse(raw);
  } catch { /* not yet generated */ }
  try {
    const raw = readFileSync(path.join(process.cwd(), "..", "results", "idv_run_v1_5.json"), "utf-8");
    idvRunV15 = JSON.parse(raw);
  } catch { /* not yet generated */ }
  return <HardCopyResultsClient idvRun={idvRun} idvRunV15={idvRunV15} />;
}
