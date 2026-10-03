import { PolicyRoute, policyMetadata } from "@/components/site/policy-route";

export const metadata = policyMetadata("privacy");

export default function Page() {
  return <PolicyRoute policy="privacy" />;
}
