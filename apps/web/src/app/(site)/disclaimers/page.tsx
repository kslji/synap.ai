import { PolicyRoute, policyMetadata } from "@/components/site/policy-route";

export const metadata = policyMetadata("disclaimers");

export default function Page() {
  return <PolicyRoute policy="disclaimers" />;
}
