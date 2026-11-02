import { Suspense } from "react";
import { PropFirmTracker } from "@/components/prop-firm-tracker";
import { CampaignRules } from "@/components/campaign-rules";
export default function PropFirmsPage() {
  return (
    <Suspense>
      <PropFirmTracker />
      {/* Below the tracker: the cash numbers are what this page is read for
          daily, and the rules panel keeps its warnings visible when collapsed. */}
      <CampaignRules />
    </Suspense>
  );
}
