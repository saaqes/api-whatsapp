export type Role = "OWNER" | "ADMIN" | "AGENT";
export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  active: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface Contact {
  id: string;
  waId: string;
  profileName: string | null;
  displayName: string | null;
  isSimulated: boolean;
  tags: string[];
  notes: string;
  aiPaused: boolean;
  needsHuman: boolean;
  needsHumanReason: string | null;
  blocked: boolean;
  optedOut: boolean;
  classification: string | null;
  lastIntent: string | null;
  summary: string;
  summaryUpdatedAt: string | null;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  unreadCount: number;
  createdAt: string;
  windowOpen: boolean;
  memories?: Memory[];
  _count?: { messages: number; memories?: number };
  usage?: { costUsd: number | null; inputTokens: number | null; outputTokens: number | null };
}

export interface Memory {
  id: string;
  contactId: string;
  category: "PERSONAL" | "PREFERENCE" | "BUSINESS" | "OTHER";
  content: string;
  source: "AUTO" | "MANUAL";
  createdAt: string;
  updatedAt: string;
}

export type MessageStatus = "RECEIVED" | "QUEUED" | "SENT" | "DELIVERED" | "READ" | "FAILED" | "SIMULATED";
export interface Message {
  id: string;
  contactId: string;
  direction: "INBOUND" | "OUTBOUND";
  author: "CONTACT" | "AI" | "HUMAN" | "AUTOMATION";
  authorName?: string | null;
  type: string;
  text: string | null;
  transcription: string | null;
  mediaId: string | null;
  mediaMime: string | null;
  mediaFilename: string | null;
  status: MessageStatus;
  replyState: "PENDING" | "ANSWERED" | "SKIPPED" | "NOT_APPLICABLE";
  skipReason: string | null;
  errorMessage: string | null;
  templateName: string | null;
  responseTimeMs: number | null;
  createdAt: string;
}

export interface ModelInfo {
  id: string;
  label: string;
  description: string;
  input: number;
  output: number;
  cacheRead: number;
  effort: boolean;
}

export interface AiSettings {
  assistantName: string;
  businessName: string;
  businessDescription: string;
  personality: string;
  tone: string;
  language: string;
  replyInUserLanguage: boolean;
  instructions: string;
  model: string;
  auxModel: string;
  effort: "low" | "medium" | "high";
  maxTokens: number;
  responseLength: "short" | "medium" | "long";
  historyMessages: number;
  memoryEnabled: boolean;
  memoryUpdateEvery: number;
  maxMemoryFacts: number;
  knowledgeEnabled: boolean;
  knowledgeResults: number;
  toolKnowledgeSearch: boolean;
  toolHandoff: boolean;
  replyDelaySeconds: number;
  splitParagraphs: boolean;
}
export interface GeneralSettings {
  assistantEnabled: boolean;
  timezone: string;
  autoPauseOnHumanReply: boolean;
  markAsRead: boolean;
  typingIndicator: boolean;
}
export interface DaySchedule {
  enabled: boolean;
  start: string;
  end: string;
}
export interface AutomationSettings {
  welcome: { enabled: boolean; text: string; thenAiReplies: boolean };
  outOfHours: { enabled: boolean; text: string; schedule: DaySchedule[]; aiRespondsOutOfHours: boolean; cooldownHours: number };
  handoff: { message: string };
  optOut: { enabled: boolean; keywords: string[]; confirmationText: string; resumeKeywords: string[]; resumeText: string };
}
export interface BudgetSettings {
  dailyUsdLimit: number;
  monthlyUsdLimit: number;
  perContactRepliesPerHour: number;
  perContactRepliesPerDay: number;
  maxInboundChars: number;
  limitMessage: string;
}
export interface MediaSettings {
  images: boolean;
  documents: boolean;
  maxDocumentMb: number;
  audio: { provider: "none" | "openai_compatible"; baseUrl: string; model: string; language: string };
}
export interface WhatsAppSettings {
  appId: string;
  wabaId: string;
  phoneNumberId: string;
  graphVersion: string;
  mode: "" | "live" | "simulation";
}
export interface SecretStatus {
  key: string;
  label: string;
  envVar: string;
  configured: boolean;
  source: "panel" | "env" | null;
  hint: string | null;
  decryptError: boolean;
  updatedAt: string | null;
}
export interface SettingsResponse {
  settings: {
    ai: AiSettings;
    general: GeneralSettings;
    automation: AutomationSettings;
    budget: BudgetSettings;
    media: MediaSettings;
    whatsapp: WhatsAppSettings;
  };
  secrets: SecretStatus[];
  models: ModelInfo[];
  webhookUrl: string | null;
  privacyUrl: string | null;
  env: { whatsappMode: string; graphVersion: string; claudeMock: boolean };
  temperatureSupported: boolean;
}

export interface CheckResult {
  ok: boolean;
  checkedAt: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface DayStat {
  day: string;
  inbound: number;
  outboundAi: number;
  outboundHuman: number;
  outboundAutomation: number;
  conversations: number;
  newContacts: number;
  avgAiResponseMs: number;
  avgHumanResponseMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
  aiCalls: number;
}

export interface ErrorLog {
  id: string;
  source: string;
  level: string;
  message: string;
  details: unknown;
  contactId: string | null;
  createdAt: string;
}

export interface KnowledgeDoc {
  id: string;
  title: string;
  kind: "NOTE" | "FAQ" | "FILE";
  content: string;
  contentLength?: number;
  question: string | null;
  answer: string | null;
  fileName: string | null;
  tags: string[];
  enabled: boolean;
  chunkCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  matchType: "CONTAINS" | "EXACT" | "STARTS_WITH" | "ANY_MESSAGE";
  keywords: string[];
  replyText: string | null;
  addTags: string[];
  handoff: boolean;
  stopAi: boolean;
  cooldownMinutes: number;
  timesTriggered: number;
}
