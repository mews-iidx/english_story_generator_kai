export type LogLevel = 'INFO' | 'WARN' | 'ERROR';
export type LogCategory = 'story' | 'call' | 'quiz_drill' | 'sync_storage' | 'system';

export interface AppLogEntry {
  id: string;
  isoTime: string;
  relativeTimeMs: number;
  level: LogLevel;
  category: LogCategory;
  tag: string;
  message: string;
  details?: Record<string, any> | string;
}

// 既存の互換性維持のためのエイリアス
export type LiveLogEntry = AppLogEntry;

const STORAGE_KEY = 'compile_eng_app_debug_logs';
const OLD_STORAGE_KEY = 'compile_eng_live_debug_logs';
const MAX_LOGS = 1500;

class AppLoggerService {
  private logs: AppLogEntry[] = [];
  private sessionStartTime: number = Date.now();
  private listeners: Array<() => void> = [];

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(OLD_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.logs = parsed.map((item: any) => ({
            id: item.id || 'log_' + Date.now(),
            isoTime: item.isoTime || new Date().toISOString(),
            relativeTimeMs: typeof item.relativeTimeMs === 'number' ? item.relativeTimeMs : 0,
            level: item.level || (item.type === 'ERROR' ? 'ERROR' : 'INFO'),
            category: item.category || 'call',
            tag: item.tag || item.type || 'LOG',
            message: item.message || '',
            details: item.details,
          }));
        }
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

  public logEntry(
    level: LogLevel,
    category: LogCategory,
    tag: string,
    message: string,
    details?: Record<string, any> | string
  ) {
    const now = Date.now();
    const entry: AppLogEntry = {
      id: 'log_' + now + '_' + Math.random().toString(36).substring(2, 6),
      isoTime: new Date(now).toISOString(),
      relativeTimeMs: now - this.sessionStartTime,
      level,
      category,
      tag,
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

    // Console output for developer inspection
    const relSec = (entry.relativeTimeMs / 1000).toFixed(2);
    const prefix = `[${level}] [${category.toUpperCase()}] [${tag}] (+${relSec}s) ${message}`;
    if (level === 'ERROR') {
      console.error(prefix, details || '');
    } else if (level === 'WARN') {
      console.warn(prefix, details || '');
    } else {
      console.log(prefix, details || '');
    }
  }

  // 互換性用（LiveLogger.log）
  public log(type: string, message: string, details?: Record<string, any> | string) {
    const isError = type === 'ERROR' || type.includes('ERROR');
    const level: LogLevel = isError ? 'ERROR' : 'INFO';
    this.logEntry(level, 'call', type, message, details);
  }

  public info(category: LogCategory, tag: string, message: string, details?: Record<string, any> | string) {
    this.logEntry('INFO', category, tag, message, details);
  }

  public warn(category: LogCategory, tag: string, message: string, details?: Record<string, any> | string) {
    this.logEntry('WARN', category, tag, message, details);
  }

  public error(category: LogCategory, tag: string, message: string, details?: Record<string, any> | string) {
    this.logEntry('ERROR', category, tag, message, details);
  }

  public logStory(tag: string, message: string, details?: Record<string, any> | string, level: LogLevel = 'INFO') {
    this.logEntry(level, 'story', tag, message, details);
  }

  public logCall(tag: string, message: string, details?: Record<string, any> | string, level: LogLevel = 'INFO') {
    this.logEntry(level, 'call', tag, message, details);
  }

  public logQuizDrill(tag: string, message: string, details?: Record<string, any> | string, level: LogLevel = 'INFO') {
    this.logEntry(level, 'quiz_drill', tag, message, details);
  }

  public logSync(tag: string, message: string, details?: Record<string, any> | string, level: LogLevel = 'INFO') {
    this.logEntry(level, 'sync_storage', tag, message, details);
  }

  public getLogs(): AppLogEntry[] {
    return [...this.logs];
  }

  public clearLogs() {
    this.logs = [];
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(OLD_STORAGE_KEY);
    this.listeners.forEach((cb) => cb());
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  public exportLogsAsText(filteredLogs?: AppLogEntry[]): string {
    const list = filteredLogs || this.logs;
    if (list.length === 0) {
      return '（該当するログはありません）';
    }

    const header = [
      '================================================================',
      ' CompileEng アプリケーション全機能 診断・計測ログ',
      ` エクスポート日時: ${new Date().toLocaleString('ja-JP')}`,
      ` 総ログ件数: ${list.length} 件 (全体: ${this.logs.length} 件)`,
      '================================================================\n',
    ].join('\n');

    const body = list
      .map((l) => {
        const timeStr = new Date(l.isoTime).toLocaleTimeString('ja-JP', { hour12: false });
        const relStr = `+${(l.relativeTimeMs / 1000).toFixed(3)}s`;
        let detailsStr = '';
        if (l.details) {
          if (typeof l.details === 'string') {
            detailsStr = `\n  [Details]: ${l.details}`;
          } else {
            try {
              detailsStr = `\n  [Details]: ${JSON.stringify(l.details, null, 2).replace(/\n/g, '\n  ')}`;
            } catch (e) {
              detailsStr = `\n  [Details]: ${String(l.details)}`;
            }
          }
        }
        return `[${timeStr} (${relStr})] [${l.level.padEnd(5)}] [${l.category.toUpperCase().padEnd(12)}] [${l.tag.padEnd(20)}] ${l.message}${detailsStr}`;
      })
      .join('\n');

    return header + body;
  }

  public downloadLogsFile(format: 'txt' | 'json' = 'txt', filteredLogs?: AppLogEntry[]) {
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, '-')
      .substring(0, 19);
    
    const list = filteredLogs || this.logs;
    let content: string;
    let mimeType: string;
    let filename: string;

    if (format === 'json') {
      content = JSON.stringify(list, null, 2);
      mimeType = 'application/json';
      filename = `compile_eng_logs_${timestamp}.json`;
    } else {
      content = this.exportLogsAsText(list);
      mimeType = 'text/plain;charset=utf-8';
      filename = `compile_eng_logs_${timestamp}.txt`;
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

export const AppLogger = new AppLoggerService();
export const LiveLogger = AppLogger; // 互換性のためのエイリアス
