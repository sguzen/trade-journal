import { Suspense } from "react";
import { Campaign } from "@/components/campaign";

export default function CampaignPage() {
  return (
    <Suspense>
      <Campaign />
    </Suspense>
  );
}
