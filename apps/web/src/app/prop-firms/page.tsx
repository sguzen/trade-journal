import { Suspense } from "react";
import { PropFirmTracker } from "@/components/prop-firm-tracker";
import { CampaignRules } from "@/components/campaign-rules";
export default function PropFirmsPage() {
  return (
    <Suspense>
      <CampaignRules />
      <PropFirmTracker />
    </Suspense>
  );
}
