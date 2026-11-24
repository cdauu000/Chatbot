import { CoSoMa } from '../../domain/types.js';
import { NormalizedRoom } from '../../domain/normalized-schema.js';
import { ConversationPlan } from '../planning/conversation-plan.js';
import { PreBookingQuoteResult } from '../../pricing/quote-types.js';
import { PolicyQueryResult } from '../../knowledge/knowledge-types.js';
import { ScoredRoomCandidate } from '../../search/search-types.js';

export interface VerifiedFactItem {
  subject: string;
  key: string;
  value: string;
  status: 'CONFIRMED' | 'UNCONFIRMED' | 'UNKNOWN';
  sourceCitation: string;
}

export interface GroundedCategoryPricing {
  category: string;
  facility: CoSoMa;
  day_2h_weekday: number;
  day_2h_weekend: number;
  extra_hour_rate_text: string;
  overnight: number;
  day_night: number;
  policyNotes?: string;
}

export interface GroundedMediaReference {
  url: string;
  alt?: string | null;
  roomName: string;
  caption?: string;
  source: 'canonical_dataset_room_anh';
}

export interface GroundedAnswerData {
  plan: ConversationPlan;
  facility: CoSoMa | null;
  focusedRoom?: NormalizedRoom | null;

  verifiedRoomIds: string[];
  verifiedRoomNames: string[];
  candidateRooms: Array<{
    item: ScoredRoomCandidate;
    quote?: PreBookingQuoteResult;
    bucket?: string;
  }>;

  verifiedFacts: VerifiedFactItem[];
  pricingResults: PreBookingQuoteResult[];
  categoryPricing?: GroundedCategoryPricing;
  policyResults: PolicyQueryResult[];
  mediaReferences: GroundedMediaReference[];

  directAnswerText?: string;
  bookingLink?: string;
  hotline?: string;
  isBudgetInsufficient?: boolean;
  budgetExplanation?: string;
  unconfirmedAmenitiesToDisclaim: string[];
}
