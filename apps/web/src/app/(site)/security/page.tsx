import { PolicyRoute, policyMetadata } from "@/components/site/policy-route";

export const metadata = policyMetadata("security");

export default function Page() {
  return <PolicyRoute policy="security" />;
}
