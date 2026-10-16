/**
 * Intent is decided in code, before any connector runs.
 * "price" alone is not finance: a question such as "rope price today" stays general.
 */
import type { Intent } from './types.js'

const FINANCE = /\b(amfi|sip|xirr|nav|bitcoin|ethereum|solana|nifty|sensex|sebi|rbi|nse|bse|coingecko|mutual fund|stock price|share price|capital gain|stcg|ltcg|profit and loss|p&l|pnl)\b/i
const LEGAL = /\b(section\s+\d+|statute|india code|penal code|constitution|not legal advice)\b/i
const CODE = /\b(github|npm|pypi|crate|crates\.io|stackoverflow|stack overflow|repository|package)\b/i
const PAPER = /\b(arxiv|paper|huggingface|hugging face|semantic scholar|preprint)\b/i
const NEWS = /\b(news|headline|hacker news|announcement|circular)\b/i

export function classifyIntent(question: string): Intent {
  if (FINANCE.test(question)) return 'finance'
  if (LEGAL.test(question)) return 'legal'
  if (PAPER.test(question)) return 'paper'
  if (CODE.test(question)) return 'code'
  if (NEWS.test(question)) return 'news'
  return 'general'
}

export function financeNeedsLive(question: string): boolean {
  if (classifyIntent(question) !== 'finance') return false
  if (/\bsip\b/i.test(question) && /\d/.test(question) && /%/.test(question) && /\d+\s*months?/i.test(question)) return false
  if (/\bxirr\b/i.test(question)) return false
  if (/\b(bought|sold|profit and loss|p&l|pnl|stcg|ltcg|capital gain)\b/i.test(question) && !/\b(nav|bitcoin|ethereum|nse|bse|nifty)\b/i.test(question)) return false
  return true
}
