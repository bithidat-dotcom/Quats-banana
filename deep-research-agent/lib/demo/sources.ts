/**
 * Bundled sample sources for offline "demo" mode.
 * They are fictional-but-realistic documents used only so the app can be
 * demonstrated without API keys. The UI and the report clearly label them
 * as sample data — never as live web results.
 */

export interface DemoSample {
  url: string;
  title: string;
  domain: string;
  publishedDate: string;
  /** Rough topical tags, used to rank samples against the user's question. */
  tags: string[];
  text: string;
}

export const DEMO_NOTICE = 'DEMO SAMPLE DOCUMENT — not a live web page. Bundled with Deep Research Agent for offline demonstration.';

export const DEMO_SAMPLES: DemoSample[] = [
  {
    url: 'https://demo.deep-research-agent.example/reports/global-storage-2025',
    title: 'Global Energy Storage Deployment Report 2025',
    domain: 'demo.deep-research-agent.example',
    publishedDate: '2025-03-18',
    tags: ['energy', 'storage', 'battery', 'grid', 'climate', 'renewable', 'electricity', 'deployment', 'statistics'],
    text: `Executive summary
Grid-scale energy storage additions reached 92 gigawatts (GW) of power capacity and 232 gigawatt-hours (GWh) of energy capacity in 2024, a 76 percent increase in energy capacity over 2023. Cumulative installed storage capacity worldwide is now about 340 GWh, of which pumped-hydro reservoirs still account for roughly 160 GWh.

Costs
The global average turnkey price for a four-hour lithium-iron-phosphate (LFP) battery system fell to 148 US dollars per kilowatt-hour in 2024, down 17 percent year over year. Analysts attribute the decline to falling cell prices, larger project sizes and cheaper financing in China.

Durations
The median new project duration rose from 2.1 hours in 2021 to 3.4 hours in 2024. Eight-hour systems remain less than 6 percent of new deployments but are growing fastest in markets with high solar penetration.

Outlook
Under the report's stated-policies scenario, annual additions reach 250 GWh by 2030. The report notes that grid connection queues, not manufacturing capacity, are the binding constraint in most markets.`,
  },
  {
    url: 'https://demo.deep-research-agent.example/news/battery-costs-fall-2025',
    title: 'Battery storage costs fall again as Chinese supply expands',
    domain: 'demo.deep-research-agent.example',
    publishedDate: '2025-06-02',
    tags: ['energy', 'storage', 'battery', 'cost', 'price', 'market', 'news', 'lithium'],
    text: `Prices for utility-scale battery storage fell for a fourth consecutive year, according to figures compiled by the news desk from project disclosures and supplier price lists.

A four-hour lithium-iron-phosphate system now averages about 152 dollars per kilowatt-hour of energy capacity, down from 179 dollars a year earlier. Two suppliers quoted prices below 130 dollars per kilowatt-hour for deliveries in 2026, though those figures exclude grid connection and land.

"Cell oversupply is doing most of the work," one procurement manager at a European utility said. "The engineering, procurement and construction margin has barely moved."

Safety codes
Updated fire codes in several jurisdictions now require thermal runaway detection and separation distances for lithium installations above 20 megawatt-hours. Compliance is adding 3 to 9 percent to installed costs, depending on the site.

The desk could not verify two of the lowest quoted prices and treats them as indicative only.`,
  },
  {
    url: 'https://demo.deep-research-agent.example/journal/duration-trends-review',
    title: 'Duration trends in grid storage: a review of 1,200 projects',
    domain: 'demo.deep-research-agent.example',
    publishedDate: '2024-11-27',
    tags: ['energy', 'storage', 'battery', 'research', 'duration', 'study', 'grid', 'peer'],
    text: `We reviewed 1,200 grid-connected storage projects commissioned between 2015 and 2024 using public registries.

Median duration increased from 1.0 hour in 2015 to 3.2 hours in 2024, consistent with the shift from frequency-regulation use cases to energy-shifting use cases. Projects above 6 hours remain concentrated in pumped hydro and compressed-air installations, which still represent about 92 percent of stored energy capacity worldwide but only 8 percent of new power capacity.

We find a systematic reporting bias: press releases overstate durations by quoting nameplate energy at beginning of life, while operators report usable energy at end of warranty. The gap averages 11 percent.

Data limitations: registries under-report behind-the-meter installations, and 2024 data is incomplete for three of the eleven largest markets.`,
  },
  {
    url: 'https://demo.deep-research-agent.example/regulator/safety-bulletin-2025',
    title: 'Safety bulletin: lithium battery storage incident statistics 2020–2024',
    domain: 'demo.deep-research-agent.example',
    publishedDate: '2025-01-09',
    tags: ['energy', 'storage', 'battery', 'safety', 'fire', 'regulation', 'government', 'statistics', 'grid'],
    text: `This bulletin summarises reported incidents at grid-scale lithium battery installations from 2020 to 2024.

Incidents: 41 fire or thermal-runaway events were reported across 18 jurisdictions, against roughly 1,400 installations in operation by the end of 2024. Reported events per installed gigawatt-hour have fallen each year since 2021: 0.9 per GWh in 2021, 0.6 in 2022, 0.4 in 2023 and 0.3 in 2024.

Causes: 58 percent of events were traced to cell manufacturing defects, 22 percent to inverter or protection failures, 12 percent to installation errors and 8 percent to undetermined causes.

Recommendations: gas detection in enclosures, remote isolation of modules, separation distances where feasible, and pre-incident plans shared with the local fire service. The bulletin notes that reporting is voluntary in most jurisdictions, so the true number of events is likely higher than reported.`,
  },
  {
    url: 'https://demo.deep-research-agent.example/market/outlook-2025-2030',
    title: 'Storage market outlook 2025–2030: scenarios and investment',
    domain: 'demo.deep-research-agent.example',
    publishedDate: '2025-05-14',
    tags: ['energy', 'storage', 'battery', 'market', 'investment', 'forecast', 'price', 'cost'],
    text: `Our base case sees global storage investment of 620 billion US dollars between 2025 and 2030. Two slower scenarios (grid queue delays, higher interest rates) and one faster scenario (capacity-market reform) are modelled.

Price outlook: we expect the benchmark four-hour system price to fall below 120 dollars per kilowatt-hour by 2028 in China and 145 dollars per kilowatt-hour in Europe, with the gap driven mainly by labour and grid-connection costs.

Disagreement: our price forecast is roughly 8 percent more pessimistic than the leading industry association's, largely because we assume higher interconnection costs. Independent analysts quoted by two news outlets expect a plateau after 2027 as cheaper sodium-ion chemistry reaches scale.

Risks: permitting timelines, fire-code compliance costs, and the availability of skilled commissioning engineers.`,
  },
  {
    url: 'https://demo.deep-research-agent.example/agency/installed-capacity-statistics',
    title: 'Installed electricity storage capacity statistics, end-2024',
    domain: 'demo.deep-research-agent.example',
    publishedDate: '2025-02-20',
    tags: ['energy', 'storage', 'battery', 'statistics', 'government', 'capacity', 'pumped', 'grid', 'deployment'],
    text: `National statistics compiled from grid operators and asset registries.

Total installed electricity storage: 342 GWh of energy capacity and 174 GW of power capacity at end-2024.

Breakdown by technology (energy capacity): pumped hydro 161 GWh (47 percent), lithium batteries 168 GWh (49 percent), compressed air and thermal 9 GWh (3 percent), other 4 GWh (1 percent).

Year-on-year change: total energy capacity grew 71 percent; lithium grew 108 percent.

Notes on definitions: power capacity is measured at point of connection; energy capacity is nameplate at beginning of life. Some jurisdictions report only power capacity, so the energy total carries an estimated 4 percent uncertainty. Figures are provisional and revised annually.`,
  },
];

/** Host that demo search results live on — never fetched over the network. */
export const DEMO_HOST = 'demo.deep-research-agent.example';

/** Resolve a demo URL to its bundled document (used instead of a real fetch). */
export function demoSampleByUrl(url: string): DemoSample | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== DEMO_HOST) return undefined;
    const path = parsed.pathname.replace(/\/+$/, '');
    return DEMO_SAMPLES.find((s) => {
      try {
        return new URL(s.url).pathname.replace(/\/+$/, '') === path;
      } catch {
        return false;
      }
    });
  } catch {
    return undefined;
  }
}

export function isDemoUrl(url: string): boolean {
  return demoSampleByUrl(url) !== undefined;
}

export function demoSamplesForQuestion(question: string, max = 6): DemoSample[] {
  const words = new Set(
    question
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter(Boolean),
  );
  const scored = DEMO_SAMPLES.map((s) => ({
    s,
    score: s.tags.reduce((acc, t) => acc + (words.has(t) ? 1 : 0), 0),
  }));
  const anyMatch = scored.some((x) => x.score > 0);
  const ranked = anyMatch
    ? scored.sort((a, b) => b.score - a.score || b.s.publishedDate.localeCompare(a.s.publishedDate))
    : scored;
  return ranked.slice(0, max).map((x) => x.s);
}
