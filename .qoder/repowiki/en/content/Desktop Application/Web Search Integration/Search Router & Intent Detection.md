# Search Router & Intent Detection

<cite>
**Referenced Files in This Document**
- [intent.ts](file://apps/desktop/src/main/core/search/intent.ts)
- [router.ts](file://apps/desktop/src/main/core/search/router.ts)
- [connectors.ts](file://apps/desktop/src/main/core/search/connectors.ts)
- [types.ts](file://apps/desktop/src/main/core/search/types.ts)
- [run.ts](file://apps/desktop/src/main/core/search/run.ts)
- [app-services.ts](file://apps/desktop/src/main/core/app-services.ts)
- [search.test.ts](file://apps/desktop/src/main/core/search/search.test.ts)
</cite>

## Table of Contents
1. [Introduction](#introduction)
2. [Project Structure](#project-structure)
3. [Core Components](#core-components)
4. [Architecture Overview](#architecture-overview)
5. [Detailed Component Analysis](#detailed-component-analysis)
6. [Dependency Analysis](#dependency-analysis)
7. [Performance Considerations](#performance-considerations)
8. [Troubleshooting Guide](#troubleshooting-guide)
9. [Conclusion](#conclusion)

## Introduction
This document explains the search routing and intent detection system used by the desktop application. It covers how user queries are classified, how local and online search strategies are selected, how connectors are chosen per intent, and how domain-specific answers for finance, legal, and news are composed. The goal is to make the decision-making logic transparent: it balances query type, available resources, freshness requirements, user preferences, and regional constraints before deciding whether to answer locally or call external sources.

## Project Structure
The search routing system lives under the desktop application’s main process core module. The relevant files are:

- `apps/desktop/src/main/core/search/intent.ts`: Intent classification and finance live-data gating.
- `apps/desktop/src/main/core/search/router.ts`: Local-first routing plan that decides whether online search is needed.
- `apps/desktop/src/main/core/search/connectors.ts`: External source connectors mapped by intent.
- `apps/desktop/src/main/core/search/types.ts`: Shared types, layer ordering, and constants.
- `apps/desktop/src/main/core/search/run.ts`: Domain-specific composition for finance, legal, and news; online gathering and fallbacks.
- `apps/desktop/src/main/core/app-services.ts`: Entry point wiring user input, settings, reachability, and routing into the search pipeline.
- `apps/desktop/src/main/core/search/search.test.ts`: Tests validating connector selection and routing behavior.

```mermaid
graph TB
User["User Query"] --> AppServices["App Services<br/>app-services.ts"]
AppServices --> Intent["Intent Classification<br/>intent.ts"]
AppServices --> Router["Routing Plan<br/>router.ts"]
Router --> Run["Domain Composition<br/>run.ts"]
Run --> Connectors["Connectors<br/>connectors.ts"]
Connectors --> Types["Types & Constants<br/>types.ts"]
```

**Diagram sources**
- [app-services.ts:1685-1726](file://apps/desktop/src/main/core/app-services.ts#L1685-L1726)
- [intent.ts:13-20](file://apps/desktop/src/main/core/search/intent.ts#L13-L20)
- [router.ts:45-66](file://apps/desktop/src/main/core/search/router.ts#L45-L66)
- [run.ts:86-107](file://apps/desktop/src/main/core/search/run.ts#L86-L107)
- [connectors.ts:122-147](file://apps/desktop/src/main/core/search/connectors.ts#L122-L147)
- [types.ts:6-10](file://apps/desktop/src/main/core/search/types.ts#L6-L10)

**Section sources**
- [intent.ts:1-29](file://apps/desktop/src/main/core/search/intent.ts#L1-L29)
- [router.ts:1-67](file://apps/desktop/src/main/core/search/router.ts#L1-L67)
- [connectors.ts:1-148](file://apps/desktop/src/main/core/search/connectors.ts#L1-L148)
- [types.ts:1-39](file://apps/desktop/src/main/core/search/types.ts#L1-L39)
- [run.ts:1-320](file://apps/desktop/src/main/core/search/run.ts#L1-L320)
- [app-services.ts:1648-1726](file://apps/desktop/src/main/core/app-services.ts#L1648-L1726)
- [search.test.ts:70-81](file://apps/desktop/src/main/core/search/search.test.ts#L70-L81)

## Core Components
- Intent classifier: Determines the query’s domain using keyword patterns.
- Routing planner: Chooses between local-only, fresh local, and online search based on intent, local hits, freshness, connectivity, and policy flags.
- Connector registry: Maps intents to a fixed set of external sources.
- Domain composer: Handles finance, legal, and news with strict grounding and citation rules.
- Online gatherer: Runs connectors, falls back to DuckDuckGo lite, caches results, and reads top pages.

Key responsibilities:
- Keep sensitive domains (finance, legal, news) grounded and verifiable.
- Prefer local data when sufficient and not stale.
- Only go online when required by intent, freshness, or missing local content.
- Respect user settings and device reachability.

**Section sources**
- [intent.ts:13-28](file://apps/desktop/src/main/core/search/intent.ts#L13-L28)
- [router.ts:8-66](file://apps/desktop/src/main/core/search/router.ts#L8-L66)
- [connectors.ts:107-147](file://apps/desktop/src/main/core/search/connectors.ts#L107-L147)
- [run.ts:86-107](file://apps/desktop/src/main/core/search/run.ts#L86-L107)
- [run.ts:276-319](file://apps/desktop/src/main/core/search/run.ts#L276-L319)

## Architecture Overview
The end-to-end flow starts from the app service layer, which prepares context such as region, offline mode, web permissions, and local hits. It then classifies intent and plans a route. For domain-specific intents, the runner composes answers directly; otherwise, it gathers online results through connectors and optional DuckDuckGo fallback.

```mermaid
sequenceDiagram
participant Client as "Client"
participant App as "App Services"
participant Router as "Router"
participant Runner as "Runner"
participant Conn as "Connectors"
participant DDG as "DuckDuckGo Lite"
Client->>App : "Submit question"
App->>App : "Prepare region, settings, local hits"
App->>Router : "planRoute(question, hits, fresh, online, webAllowed, offlineOnly, legalQuoted)"
Router-->>App : "RoutePlan{intent, online, reason, local}"
alt Finance/Legal/News
App->>Runner : "composeRouted(...)"
Runner->>Conn : "runConnectors(intent, question, ctx)"
Conn-->>Runner : "ConnectorHit[]"
Runner->>DDG : "Fallback if empty"
DDG-->>Runner : "ConnectorHit[]"
Runner-->>App : "ComposedAnswer"
else General
App->>Conn : "runConnectors(intent, question, ctx)"
Conn-->>App : "ConnectorHit[]"
App->>DDG : "Fallback if empty"
DDG-->>App : "ConnectorHit[]"
end
App-->>Client : "Answer + citations"
```

**Diagram sources**
- [app-services.ts:1685-1726](file://apps/desktop/src/main/core/app-services.ts#L1685-L1726)
- [router.ts:45-66](file://apps/desktop/src/main/core/search/router.ts#L45-L66)
- [run.ts:86-107](file://apps/desktop/src/main/core/search/run.ts#L86-L107)
- [run.ts:276-319](file://apps/desktop/src/main/core/search/run.ts#L276-L319)
- [connectors.ts:135-147](file://apps/desktop/src/main/core/search/connectors.ts#L135-L147)

## Detailed Component Analysis

### Intent Classification
The intent classifier uses simple regular expressions to detect domain signals. It prioritizes finance and legal over code and papers, then news, and finally general. A special helper determines whether a finance query requires live data.

Important behaviors:
- Finance keywords trigger finance intent, but some finance-related calculations do not require live data.
- Legal intent is triggered by statute references and related phrases.
- Code intent includes repository/package platform terms.
- Paper intent includes academic and preprint platforms.
- News intent includes headline and announcement terms.

```mermaid
flowchart TD
Start(["classifyIntent(question)"]) --> CheckFinance{"Finance keywords?"}
CheckFinance --> |Yes| ReturnFinance["Return 'finance'"]
CheckFinance --> |No| CheckLegal{"Legal keywords?"}
CheckLegal --> |Yes| ReturnLegal["Return 'legal'"]
CheckLegal --> |No| CheckPaper{"Paper keywords?"}
CheckPaper --> |Yes| ReturnPaper["Return 'paper'"]
CheckPaper --> |No| CheckCode{"Code keywords?"}
CheckCode --> |Yes| ReturnCode["Return 'code'"]
CheckCode --> |No| CheckNews{"News keywords?"}
CheckNews --> |Yes| ReturnNews["Return 'news'"]
CheckNews --> |No| ReturnGeneral["Return 'general'"]
```

**Diagram sources**
- [intent.ts:7-20](file://apps/desktop/src/main/core/search/intent.ts#L7-L20)

**Section sources**
- [intent.ts:1-29](file://apps/desktop/src/main/core/search/intent.ts#L1-L29)

### Routing Planner
The router decides whether to rely on local data or perform an online search. It considers:
- Intent classification.
- Best local hit by layer priority.
- Freshness requirement.
- Connectivity and user policy flags.
- Whether legal text is already quoted locally.

Decision rules:
- Finance requiring live data forces online unless blocked by policy.
- Legal without local quotes prefers online when allowed.
- If a strong local hit exists and freshness is not required, stay local.
- Otherwise, use online if permitted.

```mermaid
flowchart TD
Start(["planRoute(input)"]) --> Classify["Classify intent"]
Classify --> PickLocal["Pick best local hit"]
PickLocal --> CanOnline{"online && webAllowed && !offlineOnly"}
CanOnline --> FinanceLive{"intent == 'finance' AND needs live?"}
FinanceLive --> |Yes| ForceOnline["Return online = can"]
FinanceLive --> |No| LegalCheck{"intent == 'legal'"}
LegalCheck --> |Yes| LegalQuoted{"legalQuoted?"}
LegalQuoted --> |Yes| StayLocal["Return online = false"]
LegalQuoted --> |No| AllowOnline["Return online = can"]
LegalCheck --> |No| LocalStrong{"local hit exists AND NOT fresh?"}
LocalStrong --> |Yes| StayLocal
LocalStrong --> |No| DefaultOnline["Return online = can"]
```

**Diagram sources**
- [router.ts:45-66](file://apps/desktop/src/main/core/search/router.ts#L45-L66)

**Section sources**
- [router.ts:1-67](file://apps/desktop/src/main/core/search/router.ts#L1-L67)
- [search.test.ts:70-81](file://apps/desktop/src/main/core/search/search.test.ts#L70-L81)

### Connector Selection
Each intent maps to a predefined list of connectors. The runner executes them in order until enough results are collected. Failures in one connector do not prevent others from running.

Mapping:
- Code: GitHub, Stack Exchange, npm, PyPI, crates.io, Hacker News.
- Paper: arXiv, Semantic Scholar, Hugging Face, Wikipedia.
- News: Hacker News, Wikipedia.
- General: Wikipedia, Hacker News.
- Finance and legal: No default connectors; they use specialized flows.

```mermaid
classDiagram
class Intent {
<<enum>>
finance
legal
code
paper
news
general
}
class ConnectorId {
<<enum>>
github
stackexchange
npm
pypi
crates
wikipedia
arxiv
huggingface
semanticscholar
hn
}
class BY_INTENT {
+code : ConnectorId[]
+paper : ConnectorId[]
+news : ConnectorId[]
+general : ConnectorId[]
+finance : ConnectorId[]
+legal : ConnectorId[]
}
Intent --> BY_INTENT : "maps to"
BY_INTENT --> ConnectorId : "selects"
```

**Diagram sources**
- [connectors.ts:122-133](file://apps/desktop/src/main/core/search/connectors.ts#L122-L133)
- [types.ts:10](file://apps/desktop/src/main/core/search/types.ts#L10)

**Section sources**
- [connectors.ts:107-147](file://apps/desktop/src/main/core/search/connectors.ts#L107-L147)

### Domain-Specific Composition

#### Finance
Finance handling is strict: it avoids model-invented figures and enforces grounding. It supports:
- SIP and PnL math-based answers.
- Tax calculations.
- Crypto prices via live fetchers.
- Indian NAV lookups.
- RBI/SEBI RSS feeds.
- Stock price queries with regional checks.

It gates online access based on whether the question needs live data and respects offline-only and web-disabled modes.

```mermaid
flowchart TD
Start(["composeFinance(question, region, webAllowed, net, now)"]) --> Sip{"SIP pattern?"}
Sip --> |Yes| SipAnswer["Compute SIP answer"]
Sip --> |No| Pnl{"PnL pattern?"}
Pnl --> |Yes| PnlAnswer["Compute PnL answer"]
Pnl --> |No| Tax{"Tax keywords?"}
Tax --> |Yes| TaxAnswer["Compute tax answer"]
Tax --> |No| StockQ{"Stock price question?"}
StockQ --> |Yes| QuoteFlow["Compose quote or EOD"]
StockQ --> |No| LiveNeeded{"Needs live data?"}
LiveNeeded --> |No| Insufficient["Return insufficient"]
LiveNeeded --> |Yes| Crypto{"Crypto ID?"}
Crypto --> |Yes| FetchCrypto["Fetch crypto price"]
Crypto --> |No| Nav{"NAV/MF in India?"}
Nav --> |Yes| FetchNav["Fetch AMFI NAV"]
Nav --> |No| RegNews{"SEBI/RBI circular?"}
RegNews --> |Yes| FetchRSS["Fetch RSS feed"]
RegNews --> |No| Insufficient
```

**Diagram sources**
- [run.ts:190-244](file://apps/desktop/src/main/core/search/run.ts#L190-L244)

**Section sources**
- [run.ts:190-244](file://apps/desktop/src/main/core/search/run.ts#L190-L244)

#### Legal
Legal answers must be grounded in quoted statutes. If local quotes exist, they are preferred. Otherwise, the system searches official legal sources when allowed.

```mermaid
flowchart TD
Start(["composeLegal(question, hits, region, webAllowed, net, now)"]) --> LocalQuote{"Local quote found?"}
LocalQuote --> |Yes| PublishLocal["Publish legal answer from local"]
LocalQuote --> |No| WebAllowed{"webAllowed && !offlineOnly?"}
WebAllowed --> |Yes| SearchWeb["Search legal web"]
SearchWeb --> Found{"Found answer?"}
Found --> |Yes| PublishWeb["Publish legal answer from web"]
Found --> |No| Unavailable["Return unavailable"]
WebAllowed --> |No| Unavailable
```

**Diagram sources**
- [run.ts:246-254](file://apps/desktop/src/main/core/search/run.ts#L246-L254)

**Section sources**
- [run.ts:246-254](file://apps/desktop/src/main/core/search/run.ts#L246-L254)

#### News
News answers are built from fetched rows. If local hits exist and pass grounding, they are used. Otherwise, online connectors are tried, followed by DuckDuckGo fallback.

```mermaid
flowchart TD
Start(["composeNews(question, hits, region, webAllowed, net, now)"]) --> LocalHits{"Local hits present?"}
LocalHits --> |Yes| VerifyLocal["Verify grounded answer"]
VerifyLocal --> LocalOk{"Blocked?"}
LocalOk --> |No| ReturnLocal["Return local answer"]
LocalOk --> |Yes| TryOnline{"webAllowed && !offlineOnly?"}
LocalHits --> |No| TryOnline
TryOnline --> |Yes| RunConnectors["Run connectors for 'news'"]
RunConnectors --> Fallback{"Empty?"}
Fallback --> |Yes| DDGFallback["Try DuckDuckGo lite"]
Fallback --> |No| FilterFresh["Filter by freshness"]
FilterFresh --> Enough{"Enough fresh results?"}
Enough --> |Yes| Compose["Compose answer"]
Enough --> |No| Unavailable["Return unavailable"]
TryOnline --> |No| Unavailable
```

**Diagram sources**
- [run.ts:110-161](file://apps/desktop/src/main/core/search/run.ts#L110-L161)

**Section sources**
- [run.ts:110-161](file://apps/desktop/src/main/core/search/run.ts#L110-L161)

### Online Gathering and Fallbacks
When online search is allowed, the system:
- Uses intent-mapped connectors.
- Falls back to DuckDuckGo lite if connectors return nothing.
- Drops blocked sources.
- Caches connector results and page content.
- Reads up to three top pages for richer context.

```mermaid
flowchart TD
Start(["gatherOnline(question, region, offlineOnly, db, fetchImpl, signal, jsRender, now)"]) --> Classify["Classify intent"]
Classify --> ReadCache["Read cached hits"]
ReadCache --> HitsPresent{"Cached hits present?"}
HitsPresent --> |Yes| DropBlocked["Drop blocked"]
HitsPresent --> |No| RunConnectors["Run connectors(intent)"]
RunConnectors --> Empty{"Empty?"}
Empty --> |Yes| DDG["Run DuckDuckGo lite"]
Empty --> |No| DropBlocked
DDG --> DropBlocked
DropBlocked --> CacheWrite["Write cache if hits exist"]
CacheWrite --> TopPages["Read top 3 pages"]
TopPages --> Return["Return hits + pages"]
```

**Diagram sources**
- [run.ts:276-319](file://apps/desktop/src/main/core/search/run.ts#L276-L319)

**Section sources**
- [run.ts:276-319](file://apps/desktop/src/main/core/search/run.ts#L276-L319)

### Integration with App Services
The app service layer orchestrates the full flow:
- Adds legal section chunks when legal intent is detected.
- Attempts domain composition first for finance/legal/news.
- Computes freshness and reachability.
- Plans the route and optionally injects a synthetic local hit.
- Decides whether to run web search and rank passages.

```mermaid
sequenceDiagram
participant App as "App Services"
participant Store as "Local Store"
participant Router as "Router"
participant Runner as "Runner"
participant Decision as "Web Decision"
App->>Store : "Load local hits"
App->>App : "If legal, add section chunks"
App->>Runner : "composeRouted(question, hits, region, ...)"
alt Routed answer produced
Runner-->>App : "ComposedAnswer"
else Not routed
App->>App : "wantsFresh(text)"
App->>Router : "planRoute(...)"
Router-->>App : "RoutePlan"
App->>Decision : "decideWeb(local, fresh, online, offlineOnly, webAllowed)"
end
```

**Diagram sources**
- [app-services.ts:1648-1726](file://apps/desktop/src/main/core/app-services.ts#L1648-L1726)

**Section sources**
- [app-services.ts:1648-1726](file://apps/desktop/src/main/core/app-services.ts#L1648-L1726)

## Dependency Analysis
The following diagram shows how modules depend on each other during routing and execution.

```mermaid
graph LR
AppServices["app-services.ts"] --> Router["router.ts"]
AppServices --> Intent["intent.ts"]
AppServices --> Runner["run.ts"]
Runner --> Intent
Runner --> Connectors["connectors.ts"]
Runner --> Types["types.ts"]
Connectors --> Types
```

**Diagram sources**
- [app-services.ts:115-117](file://apps/desktop/src/main/core/app-services.ts#L115-L117)
- [run.ts:7-10](file://apps/desktop/src/main/core/search/run.ts#L7-L10)
- [connectors.ts:4-5](file://apps/desktop/src/main/core/search/connectors.ts#L4-L5)
- [types.ts:1-10](file://apps/desktop/src/main/core/search/types.ts#L1-L10)

**Section sources**
- [app-services.ts:115-117](file://apps/desktop/src/main/core/app-services.ts#L115-L117)
- [run.ts:7-10](file://apps/desktop/src/main/core/search/run.ts#L7-L10)
- [connectors.ts:4-5](file://apps/desktop/src/main/core/search/connectors.ts#L4-L5)
- [types.ts:1-10](file://apps/desktop/src/main/core/search/types.ts#L1-L10)

## Performance Considerations
- Local-first strategy reduces network calls and latency when sufficient local data exists.
- Freshness checks avoid unnecessary online queries for non-time-sensitive questions.
- Connector execution stops after collecting a small number of results to limit overhead.
- Caching of connector results and page content improves repeated query performance.
- Rate limiting is applied per connector to respect external API limits.
- Blocking lists and source usability checks reduce wasted work on invalid or outdated results.

[No sources needed since this section provides general guidance]

## Troubleshooting Guide
Common issues and diagnostics:
- Unexpectedly staying offline:
  - Check whether a strong local hit exists and freshness is not required.
  - Verify `webAllowed`, `offlineOnly`, and reachability flags.
- Finance answers marked insufficient:
  - Ensure the question requires live data and that connectivity is allowed.
  - Confirm region and data availability for stock/NAV/crypto flows.
- Legal answers unavailable:
  - Verify whether local statute quotes exist.
  - Ensure web access is enabled for legal web search.
- Connector failures:
  - Individual connector errors are swallowed; check whether other connectors returned results.
  - Use DuckDuckGo fallback only when all connectors return empty.

Relevant implementation areas:
- Routing decisions and reasons.
- Finance gating and live data checks.
- Legal quoting and web search.
- Connector error handling and result limits.

**Section sources**
- [router.ts:45-66](file://apps/desktop/src/main/core/search/router.ts#L45-L66)
- [run.ts:190-244](file://apps/desktop/src/main/core/search/run.ts#L190-L244)
- [run.ts:246-254](file://apps/desktop/src/main/core/search/run.ts#L246-L254)
- [connectors.ts:135-147](file://apps/desktop/src/main/core/search/connectors.ts#L135-L147)

## Conclusion
The search routing and intent detection system prioritizes safety, accuracy, and efficiency. It classifies queries into clear domains, selects appropriate connectors, and enforces strict grounding for sensitive topics like finance, legal, and news. The router favors local data when possible, goes online only when necessary, and respects user preferences and device state. This design ensures reliable, traceable answers while minimizing unnecessary network usage.

[No sources needed since this section summarizes without analyzing specific files]