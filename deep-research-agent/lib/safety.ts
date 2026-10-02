/**
 * Cheap, deterministic pre-flight screen for clearly disallowed requests.
 * The system prompt does the nuanced work; this exists so obvious cases
 * (doxxing, weapons, malware) never reach a paid provider.
 */

interface Rule {
  re: RegExp;
  category: 'privacy' | 'harmful';
  reason: string;
}

const PRIVACY_PATTERNS: RegExp[] = [
  /\b(home|house|residential|personal|private)\s+address\s+(of|for|to)\b/i,
  /\b(address|whereabouts|location)\s+of\s+(the\s+)?(house|home|residence)\b/i,
  /\b(home|mobile|cell|personal|private|unlisted)\s+(phone|telephone)\s*(number)?\s*(of|for)\b/i,
  /\bphone\s+number\s+of\s+(a|an|the)?\s*\w+/i,
  /\b(social security|national id|passport|driver'?s licen[cs]e|aadhaar|nid)\s*(number|no\.?)?\s*(of|for)\b/i,
  /\b(credit card|debit card|bank account|cvv|pin)\s*(number|details|info)?\s*(of|for)\b/i,
  /\b(dox|doxx|doxing|doxxing)\b/i,
  /\b(find|get|locate|obtain|dig up|expose|track down|uncover)\b[^.]{0,40}\b(personal|private|home)\s+(address|phone|number|email|information|details|data)\b/i,
  /\b(where does|where do)\s+[^.?]{2,40}\s+(live|work)\b/i,
  /\b(spy on|stalk|surveil)\b[^.]{0,30}\b(my|his|her|their|ex|partner|neighbou?r|boss|coworker)\b/i,
  /\bfake\s+(id|passport|licen[cs]e|invoice|receipt)\b/i,
  /\b(hack|break into|access|bypass|crack)\b[^.]{0,30}\b(someone'?s|his|her|their|another person'?s)\b[^.]{0,20}\b(account|email|phone|computer|device|profile|instagram|facebook|whatsapp)\b/i,
];

const HARMFUL_PATTERNS: RegExp[] = [
  /\bhow\s+to\s+(make|build|construct|synthesi[sz]e|manufacture|assemble|create)\b[^.]{0,50}\b(bomb|explosive|ied|napalm|thermite|pipe gun|ghost gun|silencer|suppressor|meth|methamphetamine|cocaine|fentanyl|heroin|ricin|sarin|nerve agent|poison gas|chemical weapon|biological weapon|dirty bomb|nerve gas|napalm)\b/i,
  /\b(recipe|instructions?|steps?|guide|blueprint|schematic)s?\b[^.]{0,40}\b(for|to)\b[^.]{0,40}\b(bomb|explosive|meth|fentanyl|ricin|nerve agent|biological weapon)\b/i,
  /\b(malware|ransomware|spyware|keylogger|botnet|rootkit|trojan|backdoor|credential stealer)\b[^.]{0,40}\b(code|source|script|build|create|write|download)\b/i,
  /\b(write|create|build|generate|develop)\b[^.]{0,30}\b(malware|ransomware|virus|keylogger|trojan|phishing (page|site|kit)|spyware)\b/i,
  /\b(ddos|denial of service)\b[^.]{0,30}\b(a|the|my|his|her|their)?\s*(website|server|target|company|school)\b/i,
  /\b(buy|sell|order|purchase)\b[^.]{0,30}\b(cocaine|heroin|meth|fentanyl|mdma|ecstasy|opium|illegal (guns?|weapons?)|glock switch|stolen (credit cards?|data|accounts?))\b/i,
  /\b(child|minor|underage|preteen|toddler)\b[^.]{0,25}\b(porn|pornography|sexual|nude|nudes|erotic|sex)\b/i,
  /\b(kill|murder|assassinate|poison|harm)\b[^.]{0,30}\b(someone|somebody|him|her|them|my (wife|husband|ex|boss|neighbou?r|coworker|teacher)|a (person|human|man|woman|child))\b/i,
  /\b(human trafficking|smuggle|smuggling|counterfeit money|launder money|money laundering)\b[^.]{0,30}\b(how|help|guide|plan|route|scheme)\b/i,
  /\b(bypass|evade|circumvent)\b[^.]{0,30}\b(law|police|customs|security check|age verification|kxc?|av|antivirus)\b/i,
  /\b(csam|child sexual abuse material)\b/i,
];

const RULES: Rule[] = [
  ...PRIVACY_PATTERNS.map((re) => ({
    re,
    category: 'privacy' as const,
    reason: 'finding private personal information about someone',
  })),
  ...HARMFUL_PATTERNS.map((re) => ({
    re,
    category: 'harmful' as const,
    reason: 'harmful or illegal activity',
  })),
];

export interface SafetyVerdict {
  allowed: boolean;
  category?: 'privacy' | 'harmful';
  reason?: string;
}

export function screenQuestion(question: string): SafetyVerdict {
  const text = question.slice(0, 2000);
  for (const rule of RULES) {
    if (rule.re.test(text)) return { allowed: false, category: rule.category, reason: rule.reason };
  }
  return { allowed: true };
}

export function refusalMessage(category?: 'privacy' | 'harmful'): string {
  if (category === 'privacy') {
    return "I can't help gather private personal information about someone (home addresses, phone numbers, ID numbers, credentials, or anything similar). I can research public-figure statements, publicly published records, or how to protect your own data instead.";
  }
  return "I can't help with that — it asks for instructions for harmful or illegal activity. I can research the public science, law, history, or safety side of a topic instead.";
}
