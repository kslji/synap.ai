import { PolicyRoute, policyMetadata } from "@/components/site/policy-route";

export const metadata = policyMetadata("acceptable-use");

export default function Page() {
  return <PolicyRoute policy="acceptable-use" />;
}
