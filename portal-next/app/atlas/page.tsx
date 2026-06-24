import { readFileSync } from "fs";
import path from "path";
import { AtlasClient } from "@/components/AtlasClient";

export const dynamic = "force-static";

export default function AtlasPage() {
  const atlas = readFileSync(path.join(process.cwd(), "content", "ATLAS.md"), "utf-8");
  const standards = readFileSync(path.join(process.cwd(), "content", "STANDARDS.md"), "utf-8");
  const compliance = readFileSync(path.join(process.cwd(), "content", "COMPLIANCE.md"), "utf-8");
  return <AtlasClient atlas={atlas} standards={standards} compliance={compliance} />;
}
