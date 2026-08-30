import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Play",
  description:
    "Mine layered strata, refine ore and build a working mining city, in the browser. " +
    "No wallet or sign-up needed.",
};

export default function PlayLayout({ children }: { children: React.ReactNode }) {
  return children;
}
