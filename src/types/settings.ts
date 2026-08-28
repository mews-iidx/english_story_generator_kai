export type CefrLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1';

export interface AppSettings {
  geminiApiKey: string;
  geminiModel: string;
  cefrLevel: CefrLevel;
  googleClientId: string;
  googleSpreadsheetId: string | null;
  googleAccessToken: string | null;
  lastSyncedAt: string | null;
}

export const DEFAULT_SETTINGS: AppSettings = {
  geminiApiKey: '',
  geminiModel: 'gemini-3.7-flash',
  cefrLevel: 'A2',
  googleClientId: '',
  googleSpreadsheetId: null,
  googleAccessToken: null,
  lastSyncedAt: null,
};