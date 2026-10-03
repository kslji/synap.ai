import Link from "next/link";
import { policies } from "@/lib/site-policies";

const order = ["privacy", "terms", "acceptable-use", "security", "disclaimers"] as const;

export function PolicyPage({ policy }: { policy: keyof typeof policies }) {
  const doc = policies[policy];
  return (
    <main className="site-container min-h-[75vh] py-16">
      <p className="kicker mb-4">SYNAP.SURF / POLICIES</p>
      <h1 className="max-w-3xl font-display text-4xl font-extrabold md:text-6xl">{doc.title}</h1>
      <p className="mt-6 max-w-3xl text-lg leading-relaxed text-foreground/70">{doc.intro}</p>
      <div className="mt-12 grid gap-10 border-t border-border pt-10 lg:grid-cols-[220px_1fr]">
        <aside>
          <p className="kicker mb-4">DOCUMENTS</p>
          <nav className="flex flex-col gap-3 text-sm">
            {order.map((key) => (
              <Link
                key={key}
                href={`/${key}`}
                className={key === policy ? "font-bold text-primary" : "hover:text-primary"}
              >
                {policies[key].title}
              </Link>
            ))}
          </nav>
        </aside>
        <div className="max-w-3xl space-y-9">
          {doc.sections.map(([heading, text]) => (
            <section key={heading}>
              <h2 className="font-display text-xl font-bold">{heading}</h2>
              <p className="mt-3 leading-relaxed text-foreground/70">{text}</p>
            </section>
          ))}
          <div className="border-t border-border pt-6 text-sm text-foreground/60">
            For questions about these documents, please use the{" "}
            <Link href="/contact" className="underline underline-offset-4">
              contact page
            </Link>
            .
          </div>
        </div>
      </div>
    </main>
  );
}
