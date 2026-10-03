import type { Metadata } from "next";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/site/button";

export const metadata: Metadata = {
  title: "Contact — Synap.surf",
  description: "Contact Synap.surf about the platform, an agent idea or a custom business agent.",
};

export default function ContactPage() {
  return (
    <main className="site-container min-h-[75vh] py-16">
      <p className="kicker mb-4">(04) CONTACT</p>
      <div className="grid grid-cols-12 gap-10">
        <div className="col-span-12 lg:col-span-6">
          <h1 className="font-display text-4xl font-extrabold md:text-6xl">
            Let&apos;s talk
            <br />
            <span className="text-primary">about your idea.</span>
          </h1>
          <p className="mt-6 max-w-md text-lg text-foreground/70">
            Share what you&apos;re building or ask a question about Synap. We welcome conversations about niche and
            business agents.
          </p>
        </div>
        <div className="signal-card col-span-12 flex flex-col justify-between p-7 md:p-9 lg:col-span-6">
          <div>
            <p className="kicker mb-4">GET IN TOUCH</p>
            <h2 className="font-display text-2xl font-bold">Connect with the builder</h2>
            <p className="mt-4 max-w-md leading-relaxed text-foreground/70">
              For platform questions or a custom agent inquiry, reach out to Kabir Singh Lamba through the profile
              linked on the current Synap website.
            </p>
          </div>
          <Button asChild variant="signal" size="lg" className="mt-10 self-start">
            <a href="https://www.linkedin.com/in/kabir-singh-lamba-datawizard/" target="_blank" rel="noopener noreferrer">
              Open LinkedIn profile <ExternalLink />
            </a>
          </Button>
        </div>
      </div>
    </main>
  );
}
