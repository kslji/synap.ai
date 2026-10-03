import { PolicyRoute, policyMetadata } from "@/components/site/policy-route";

export const metadata = policyMetadata("terms");

export default function Page() {
  return <PolicyRoute policy="terms" />;
}
