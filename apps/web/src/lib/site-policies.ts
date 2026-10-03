export const policies = {
  privacy: {
    title: 'Privacy policy', description: 'How Synap.surf approaches data, local use and privacy.',
    intro: 'Synap is designed around local-first use. This notice explains the distinction between information handled on your device and information that may be involved when you choose online features or contact us.',
    sections: [
      ['Local activity', 'Work performed entirely on your device stays on that device unless you choose to share, sync, export or use a connected service. You are responsible for your local files, device access and backups.'],
      ['Online services', 'Online features may send the information needed to fulfill a request to a connected provider. Before using a connected feature with sensitive information, review the applicable provider terms and settings. Exact providers and retention periods should be confirmed before launch.'],
      ['Website information', 'A website host may process basic technical information such as IP address and request logs to deliver and protect this site. We have not represented that analytics, tracking or cookies are in use.'],
      ['Contact', 'If you contact us through an external channel, that channel processes the information you choose to share according to its own policy. Avoid sending sensitive personal or financial details in an initial inquiry.'],
      ['Your choices', 'You can stop using connected features, remove locally stored content through your device or app controls where available, and request information about any data we hold through the contact page.'],
      ['Updates', 'This notice may be revised as services and infrastructure change. A definitive launch policy should identify the operating company, jurisdiction, actual service providers, retention periods and privacy contact.'],
    ],
  },
  terms: {
    title: 'Terms of service', description: 'Terms for using the Synap.surf website and AI platform.',
    intro: 'These terms describe the intended ground rules for the Synap website and platform. They do not replace a signed agreement for custom services. Final legal terms require review before commercial launch.',
    sections: [
      ['Using Synap', 'Use the website and software lawfully and in accordance with any applicable license, third-party model terms and instructions supplied with a release. Do not misuse the service or interfere with others.'],
      ['AI outputs', 'AI responses may be incomplete, incorrect or unsuitable for your circumstances. Review and independently verify important information. Synap does not provide professional financial, investment, legal or medical advice.'],
      ['Your content', 'You remain responsible for the content you provide, your right to use it, and the decisions you make using outputs. Do not provide content you are not authorized to process.'],
      ['Downloads and third parties', 'Availability and compatibility of releases can change. Connected features and third-party models or services may have their own terms, charges and limitations.'],
      ['Custom work', 'Scope, deliverables, ownership, fees, support and timelines for bespoke agents must be agreed in a separate written agreement.'],
      ['Changes and availability', 'Features may be added, upgraded, changed or discontinued. We do not guarantee uninterrupted availability or a specific accuracy level.'],
      ['Liability and governing details', 'Applicable warranties, liability limits, governing law, company identity and formal notice address must be established in final legal terms before a commercial launch.'],
    ],
  },
  'acceptable-use': {
    title: 'Acceptable use', description: 'Rules for responsible use of Synap.surf AI agents.',
    intro: 'Synap agents are intended for helpful, lawful work. The following boundaries support safe and responsible use.',
    sections: [
      ['Lawful use', 'Do not use Synap to facilitate illegal activity, fraud, abuse, harassment or violations of another person’s rights.'],
      ['Sensitive decisions', 'Do not rely on an agent alone for decisions involving money, health, employment, legal rights or other consequential matters. Keep qualified human review in the loop.'],
      ['Security and privacy', 'Do not attempt unauthorized access, distribute malware, invade privacy or process information without appropriate permission.'],
      ['Truthfulness', 'Do not present AI-generated content as verified fact when it has not been checked, or use it to impersonate or mislead others.'],
      ['Enforcement', 'Where an online service is offered, access may be limited for misuse, subject to the final service agreement and applicable law.'],
    ],
  },
  security: {
    title: 'Security & data', description: 'Local-first data handling and security considerations for Synap.surf.',
    intro: 'Local-first design gives you more control, but security still depends on your device, configuration and any online services you choose to use.',
    sections: [
      ['On-device work', 'Keep your operating system updated, use device encryption and access controls, and back up important files. A local-first design does not make a compromised device safe.'],
      ['Connected features', 'When a task uses a connected model, integration or small cloud service, some data may leave your device. Review settings and avoid sharing sensitive data unless you understand the destination.'],
      ['Release integrity', 'Install software only from a verified official release source. Specific signing, update and audit practices should be confirmed with the released desktop packages before they are claimed.'],
      ['Reporting issues', 'If you identify a security concern, use the contact page and avoid publicly disclosing details that could put others at risk before a response.'],
    ],
  },
  disclaimers: {
    title: 'AI & domain disclaimers', description: 'Important limitations for Synap.surf AI, finance, crypto and kundali agents.',
    intro: 'Agents help you explore information and ideas. They can make mistakes. Their output is not a substitute for a qualified professional or your own judgment.',
    sections: [
      ['Finance and investments', 'Finance and investment outputs are informational only, not individualized financial advice, investment recommendations or a promise of returns. Verify figures and consult a licensed professional where appropriate.'],
      ['Crypto', 'Digital assets are volatile and carry significant risk. Crypto agent content is educational, not trading advice. Independently verify market information and understand the possibility of loss.'],
      ['Kundali and horoscopes', 'Astrological interpretations are offered for cultural interest and personal reflection, not as scientific predictions or a basis for consequential decisions.'],
      ['Creative work', 'AI-generated stories and poetry may be similar to existing works or contain inaccuracies. Review originality, attribution and rights before publication.'],
      ['Accuracy and availability', 'Agents may be updated based on evaluations, but accuracy is not guaranteed. Offline capability depends on the installed package, model and task; connected features require a network.'],
    ],
  },
} as const;
