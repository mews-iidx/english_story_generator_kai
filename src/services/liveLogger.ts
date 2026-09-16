export interface LiveLogEntry {
  id: string;
  isoTime: string;
  relativeTimeMs: number;
  type:
    | 'INIT'
    | 'WS_CONNECTING'
    | 'WS_CONNECTED'
    | 'SETUP_SENT'
    | 'SETUP_COMPLETE'
    | 'KICKOFF_SENT'
    | 'USER_SPEECH_START'
    | 'USER_SPEECH_END'
    | 'USER_CHUNK'
    | 'USER_COMMITTED'
    | 'ASST_FIRST_AUDIO'
    | 'ASST_TRANSCRIPT'
    | 'TURN_COMPLETE'
    | 'INTERRUPTED'
    | 'DISCONNECTED'
    | 'ERROR';
  message: string;
  details?: Record<string, any>;
}

const STORAGE_KEY = 'compile_eng_live_debug_logs';
const MAX_LOGS = 1000;

class LiveLoggerService {
  private logs: LiveLogEntry[] = [];
  private sessionStartTime: number = Date.now();
  private listeners: Array<() => void> = [];

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        this.logs = JSON.parse(raw);
      }
    } catch (e) {
      this.logs = [];
    }
  }

  private saveToStorage() {
    try {
      if (this.logs.length > MAX_LOGS) {
        this.logs = this.logs.slice(-MAX_LOGS);
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.logs));
    } catch (e) {}
  }

  public resetSessionTime() {
    this.sessionStartTime = Date.now();
  }

  public log(
    type: LiveLogEntry['type'],
    message: string,
    details?: Record<string, any>
  ) {
    const now = Date.now();
    const entry: LiveLogEntry = {
      id: 'log_' + now + '_' + Math.random().toString(36).substring(2, 5),
      isoTime: new Date(now).toISOString(),
      relativeTimeMs: now - this.sessionStartTime,
      type,
      message,
      details,
    };

    this.logs.push(entry);
    this.saveToStorage();

    // Notify UI listeners
    this.listeners.forEach((cb) => {
      try {
        cb();
      } catch (e) {}
    });

    // Console output for devtools
    const relSec = (entry.relativeTimeMs / 1000).toFixed(2);
    console.log(`[LiveLog +${relSec}s] [${type}] ${message}`, details || '');
  }

  public getLogs(): LiveLogEntry[] {
    return [...this.logs];
  }

  public clearLogs() {
    this.logs = [];
    localStorage.removeItem(STORAGE_KEY);
    this.listeners.forEach((cb) => cb());
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  public exportLogsAsText(): string {
    if (this.logs.length === 0) {
      return '（ログはまだ記録されていません）';
    }

    const header = [
      '================================================================',
      ' CompileEng Gemini Live リアルタイム通信・計測ログ',
      ` エクスポート日時: ${new Date().toLocaleString('ja-JP')}`,
      ` 総ログ件数: ${this.logs.length} 件`,
      '================================================================\n',
    ].join('\n');

    const body = this.logs
      .map((l) => {
        const timeStr = new Date(l.isoTime).toLocaleTimeString('ja-JP', { hour12: false });
        const relStr = `+${(l.relativeTimeMs / 1000).toFixed(3)}s`;
        const detailsStr = l.details ? ` | ${JSON.stringify(l.details)}` : '';
        return `[${timeStr} (${relStr})] [${l.type.padEnd(16)}] ${l.message}${detailsStr}`;
      })
      .join('\n');

    return header + body;
  }

  public downloadLogsFile(format: 'txt' | 'json' = 'txt') {
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, '-')
      .substring(0, 19);
    
    let content: string;
    let mimeType: string;
    let filename: string;

    if (format === 'json') {
      content = JSON.stringify(this.logs, null, 2);
      mimeType = 'application/json';
      filename = `compile_eng_live_logs_${timestamp}.json`;
    } else {
      content = this.exportLogsAsText();
      mimeType = 'text/plain;charset=utf-8';
      filename = `compile_eng_live_logs_${timestamp}.txt`;
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

export const LiveLogger = new LiveLoggerService();
