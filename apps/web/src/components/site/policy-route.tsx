import type { Metadata } from "next";
import { PolicyPage } from "@/components/site/policy-page";
import { policies } from "@/lib/site-policies";

export function policyMetadata(policy: keyof typeof policies): Metadata {
  return {
    title: `${policies[policy].title} — Synap.surf`,
    description: policies[policy].description,
  };
}

export function PolicyRoute({ policy }: { policy: keyof typeof policies }) {
  return <PolicyPage policy={policy} />;
}
