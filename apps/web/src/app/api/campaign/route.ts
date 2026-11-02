import { campaignData } from "@/server/campaign";
import { handler, ok } from "@/server/api";

export const GET = handler(() => ok(campaignData()));
