import { SiteFooter, SiteNav } from "@/ui/site/SiteChrome";
import {
  CratesSection,
  EconomicLoop,
  EconomySection,
  Faq,
  FinalCta,
  Hero,
  HowItWorks,
  MarketSection,
  ResourceLadder,
  Roadmap,
} from "@/ui/site/sections";

const REPO_URL = process.env.NEXT_PUBLIC_REPO_URL;

export default function LandingPage() {
  return (
    <>
      <SiteNav />
      <main>
        <Hero />
        <HowItWorks />
        <EconomicLoop />
        <EconomySection />
        <CratesSection />
        <ResourceLadder />
        <MarketSection />
        <Roadmap />
        <Faq />
        <FinalCta />
      </main>
      <SiteFooter repoUrl={REPO_URL} />
    </>
  );
}
