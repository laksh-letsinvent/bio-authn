"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { useState, useEffect } from "react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import {
  Menu, Sun, Moon, Monitor,
  BookOpen, Map, Zap, BarChart2, Shield, Radio,
  FileText, ScanText, CheckSquare, FlaskConical,
} from "lucide-react";

const BRAND = process.env.NEXT_PUBLIC_BRAND ?? "face-value";

const FACE_VALUE_NAV = [
  { href: "/",          label: "The Experiment", icon: BookOpen },
  { href: "/atlas",     label: "Atlas",           icon: Map },
  { href: "/matching",  label: "Matching",        icon: Zap },
  { href: "/liveness",  label: "PAD",             icon: Shield },
  { href: "/findings",  label: "Findings",        icon: BarChart2 },
  { href: "/live",      label: "Live Demo",       icon: Radio, badge: "local" },
];

const HARD_COPY_NAV = [
  { href: "/hardcopy",          label: "The Experiment", icon: BookOpen },
  { href: "/hardcopy/atlas",    label: "Atlas",           icon: Map },
  { href: "/hardcopy/action",   label: "IDV in Action",   icon: ScanText },
  { href: "/hardcopy/tryout",   label: "Try It",          icon: FlaskConical },
  { href: "/hardcopy/results",  label: "Results",         icon: BarChart2 },
];

const BRAND_META = {
  "face-value": {
    name: "Face Value",
    sub: "Bio Auth · Eval",
    footer: "ArcFace · VLM · PAD",
    homeHref: "/",
    nav: FACE_VALUE_NAV,
  },
  "hard-copy": {
    name: "Hard Copy",
    sub: "Document IDV · Eval",
    footer: "VLM · OCR · ArcFace",
    homeHref: "/hardcopy",
    nav: HARD_COPY_NAV,
  },
};

const meta = BRAND_META[BRAND as keyof typeof BRAND_META] ?? BRAND_META["face-value"];

function NavLinks({ pathname, onClick }: { pathname: string; onClick?: () => void }) {
  return (
    <nav className="flex flex-col gap-0.5">
      {meta.nav.map((item) => {
        const Icon = item.icon;
        const active =
          item.href === meta.homeHref
            ? pathname === item.href || pathname === item.href + "/"
            : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onClick}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all ${
              active
                ? "bg-[var(--primary-wash)] text-[var(--accent-c)] font-semibold border border-[var(--accent-c)]/20"
                : "text-[var(--foreground)] hover:text-[var(--accent-c)] hover:bg-[var(--surface-2)] font-medium"
            }`}
          >
            <Icon size={15} className={active ? "text-[var(--accent-c)]" : "text-[var(--text-2)]"} />
            <span className="flex-1">{item.label}</span>
            {"badge" in item && item.badge && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--uncertain-zone)] text-[var(--uncertain)] font-mono">
                {item.badge}
              </span>
            )}
          </Link>
        );
      })}

      {/* Cross-link to sibling portal */}
      <div className="mt-4 pt-3 border-t border-[var(--border-c)]">
        {BRAND === "hard-copy" ? (
          <a
            href="https://bio-authn.letsinvent.co.uk"
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-xs text-[var(--text-3)] hover:text-[var(--text-2)] hover:bg-[var(--surface-2)] transition-all"
          >
            <Zap size={12} className="shrink-0" />
            <span>Face Value →</span>
          </a>
        ) : (
          <a
            href="https://bio-idv.letsinvent.co.uk"
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-xs text-[var(--text-3)] hover:text-[var(--text-2)] hover:bg-[var(--surface-2)] transition-all"
          >
            <FileText size={12} className="shrink-0" />
            <span>Hard Copy →</span>
          </a>
        )}
      </div>
    </nav>
  );
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <div className="w-8 h-8" />;

  const cycle = () => {
    if (theme === "dark") setTheme("light");
    else if (theme === "light") setTheme("system");
    else setTheme("dark");
  };

  return (
    <button
      onClick={cycle}
      className="p-1.5 rounded-lg text-[var(--text-2)] hover:text-[var(--foreground)] hover:bg-[var(--surface-2)] transition-colors"
      title={`Theme: ${theme}`}
    >
      {theme === "dark" ? <Moon size={15} /> : theme === "light" ? <Sun size={15} /> : <Monitor size={15} />}
    </button>
  );
}

function SidebarContent({ pathname, onClose }: { pathname: string; onClose?: () => void }) {
  return (
    <div className="flex flex-col h-full bg-[var(--surface)] border-r border-[var(--border-c)]">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-[var(--border-c)]">
        <Link href={meta.homeHref} onClick={onClose} className="block">
          <div
            className="text-xl font-bold tracking-tight leading-tight"
            style={{ fontFamily: "var(--font-display)", color: "var(--foreground)" }}
          >
            {meta.name}
          </div>
          <div className="text-[11px] text-[var(--accent-c)] font-medium mt-0.5">{meta.sub}</div>
        </Link>
      </div>

      {/* Nav */}
      <div className="flex-1 px-3 py-4 overflow-y-auto">
        <NavLinks pathname={pathname} onClick={onClose} />
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-[var(--border-c)] flex items-center justify-between">
        <div className="text-[11px] text-[var(--text-2)] font-mono">{meta.footer}</div>
        <ThemeToggle />
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-col min-h-screen">
      {/* Top accent bar */}
      <div
        className="fixed top-0 left-0 right-0 z-50 h-[3px]"
        style={{ background: "linear-gradient(90deg, var(--accent-c) 0%, var(--accent-2) 50%, var(--accept) 100%)" }}
      />

      <div className="flex flex-1 pt-[3px]">
        {/* Desktop sidebar */}
        <aside
          className="hidden lg:flex lg:flex-col shrink-0 sticky top-[3px] h-[calc(100vh-3px)] overflow-y-auto"
          style={{ width: "var(--sidebar-w)" }}
        >
          <SidebarContent pathname={pathname} />
        </aside>

        {/* Mobile header */}
        <div className="lg:hidden fixed top-[3px] left-0 right-0 z-40 flex items-center gap-3 px-4 py-3 bg-[var(--surface)] border-b border-[var(--border-c)]">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger className="p-1.5 rounded-lg text-[var(--text-2)] hover:text-[var(--foreground)] hover:bg-[var(--surface-2)] transition-colors">
              <Menu size={20} />
            </SheetTrigger>
            <SheetContent side="left" className="p-0 bg-[var(--surface)] border-[var(--border-c)]" style={{ width: "var(--sidebar-w)" }}>
              <SidebarContent pathname={pathname} onClose={() => setOpen(false)} />
            </SheetContent>
          </Sheet>
          <div className="flex-1 flex items-baseline gap-2">
            <span className="text-base font-bold" style={{ fontFamily: "var(--font-display)", color: "var(--foreground)" }}>
              {meta.name}
            </span>
            <span className="text-[11px] text-[var(--accent-c)] font-medium">{meta.sub}</span>
          </div>
          <ThemeToggle />
        </div>

        {/* Main content */}
        <main className="flex-1 min-w-0 lg:pt-0 pt-[52px]">
          <div className="min-h-screen" style={{ background: "var(--page-glow), var(--background)" }}>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
