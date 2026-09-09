import { Persona } from '../types/persona';

export type CallConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error' | 'disconnected';

export interface GeminiLiveCallbacks {
  onStateChange: (state: CallConnectionState, errorMsg?: string) => void;
  onUserTranscript: (text: string) => void;
  onAssistantTranscript: (text: string) => void;
  onVolumeChange: (userVolume: number, assistantVolume: number) => void; // 0.0〜1.0 (波形アニメーション用)
  onTurnComplete: () => void;
  onInterrupted: () => void;
}

export interface GeminiLiveSessionOptions {
  apiKey: string;
  persona?: Persona | null;
  isPushToTalk: boolean;
  voiceName?: string;
  callbacks: GeminiLiveCallbacks;
}

/**
 * ペルソナとバイリンガルサポート用のシステムプロンプト生成
 */
export function buildLiveSystemInstruction(persona?: Persona | null): string {
  let personaPrompt = '';
  
  if (persona) {
    let memoryPrompt = '';
    const memory = persona.memory;
    if (memory) {
      if (memory.likes && memory.likes.length > 0) {
        memoryPrompt += `\n- 好きなもの・趣味: ${memory.likes.join(', ')}`;
      }
      if (memory.dislikes && memory.dislikes.length > 0) {
        memoryPrompt += `\n- 嫌い・苦手なもの: ${memory.dislikes.join(', ')}`;
      }
      if (memory.userNotes && memory.userNotes.length > 0) {
        memoryPrompt += `\n- ユーザーについて知っていること: ${memory.userNotes.join(', ')}`;
      }
      if (memory.recentTopics && memory.recentTopics.length > 0) {
        const top3 = memory.recentTopics.slice(0, 3).map(t => `${t.topic} (${t.summary})`).join('; ');
        memoryPrompt += `\n- 最近話したトピック: ${top3}`;
      }
      if (memory.promisesOrFutureTasks && memory.promisesOrFutureTasks.length > 0) {
        memoryPrompt += `\n- 前回からの約束・宿題: ${memory.promisesOrFutureTasks.join(', ')}`;
      }
    }

    let timeElapsedPrompt = '';
    if (persona.lastSpokenAt) {
      const last = new Date(persona.lastSpokenAt).getTime();
      const now = Date.now();
      const days = Math.floor((now - last) / (1000 * 60 * 60 * 24));
      if (days === 0) {
        timeElapsedPrompt = '前回の通話から数時間〜同日中の会話です。';
      } else {
        timeElapsedPrompt = `前回の会話から【${days}日】が経過しています。久しぶりの場合は「Hey! 久しぶり！」など自然にリアクションしてください。`;
      }
    }

    personaPrompt = `【あなたのペルソナ情報】
- 名前: ${persona.name}
- 年齢/職業: ${persona.age}歳, ${persona.occupation}
- 出身/母国語: ${persona.nationality}, 母国語: ${persona.nativeLanguage}
- 性格・口調: ${persona.personality}
- 主な関心事: ${persona.interests?.join(', ')}
- レベル感: ${persona.cefrLevel || 'A2'}レベルの学習者に伝わりやすいクリアな英語で話す
- 時間経過: ${timeElapsedPrompt}
${memoryPrompt ? `【蓄積された記憶と一貫した嗜好】${memoryPrompt}\n※一度「好き」「嫌い」「見た/見てない」と言った設定は一貫性を保ち、その人の性格に基づいた行動原理で振る舞ってください。` : ''}
`;
  } else {
    personaPrompt = `【あなたの役割】
あなたは親切でフレンドリーな英語会話メンター「CompileEng AI」です。ユーザーと楽しく自然な日常英会話のラリーを行ってください。`;
  }

  return `あなたは音声通話によるLanguage Exchange（英会話パートナー）です。
${personaPrompt}

【最重要会話ルール】
1. 【超ショートラリー（1〜2文）】: 一度に長く喋りすぎず、1〜2文（5〜10秒程度）のテンポ良い日常英会話で返答し、相手に質問や相槌を返して会話のキャッチボールを維持してください。
2. 【バイリンガル・ヘルパー機能】:
   - ユーザーが英語で話しているときは、自然な英語で会話を続けてください。
   - もしユーザーが日本語で「これ英語で何て言う？」「〜の意味は？」と質問したり、詰まって日本語で助けを求めた場合は、即座に親切な日本語で1文で解説し、その英語表現を発音してみせてから「言ってみて！」と促して自然に英語の会話へ戻してください。
3. 【考え中への寛容さ】: ユーザーが「Ummm...」「Well...」「えーっと...」「あー...」と言ったり、言葉を探して短い沈黙があるときは、話を遮らずに待ってください。`;
}

/**
 * Gemini Live API WebSocket クライアントクラス
 */
export class GeminiLiveSession {
  private ws: WebSocket | null = null;
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private audioInputNode: MediaStreamAudioSourceNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private isPushToTalkActive: boolean = false;
  private isPushToTalkMode: boolean = false;
  private isMuted: boolean = false;
  private playbackQueue: AudioBufferSourceNode[] = [];
  private nextPlaybackTime: number = 0;
  private options: GeminiLiveSessionOptions;
  private connectionState: CallConnectionState = 'idle';
  private currentAssistantVolume: number = 0;

  constructor(options: GeminiLiveSessionOptions) {
    this.options = options;
    this.isPushToTalkMode = options.isPushToTalk;
  }

  public async start(): Promise<void> {
    this.updateState('connecting');

    try {
      // 1. Web Audio Context 初期化
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.audioContext = new AudioCtx();
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      // 2. マイク音声の取得
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      // 3. WebSocket 接続
      const apiKey = this.options.apiKey;
      const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${apiKey}`;
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.sendInitialSetup();
        this.updateState('connected');
        this.setupMicrophonePipeline();
      };

      this.ws.onmessage = async (event: MessageEvent) => {
        await this.handleIncomingMessage(event.data);
      };

      this.ws.onerror = (err) => {
        console.error('Gemini Live WebSocket Error:', err);
        this.updateState('error', 'WebSocket接続エラーが発生しました');
      };

      this.ws.onclose = (event) => {
        console.log('Gemini Live WebSocket Closed:', event.code, event.reason);
        if (this.connectionState !== 'disconnected') {
          this.updateState('disconnected');
        }
      };

    } catch (err: any) {
      console.error('Failed to start Gemini Live session:', err);
      this.updateState('error', err.message || 'マイクまたは通話の初期化に失敗しました');
    }
  }

  private sendInitialSetup(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const voiceName = this.options.persona?.voiceName || this.options.voiceName || 'Aoede';
    const systemPrompt = buildLiveSystemInstruction(this.options.persona);

    const setupMsg = {
      setup: {
        model: 'models/gemini-2.0-flash-exp',
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: voiceName,
              },
            },
          },
        },
        systemInstruction: {
          parts: [{ text: systemPrompt }],
        },
      },
    };

    this.ws.send(JSON.stringify(setupMsg));
  }

  private setupMicrophonePipeline(): void {
    if (!this.audioContext || !this.mediaStream) return;

    this.audioInputNode = this.audioContext.createMediaStreamSource(this.mediaStream);
    // 4096 samples at audioContext.sampleRate
    this.processorNode = this.audioContext.createScriptProcessor(4096, 1, 1);

    this.processorNode.onaudioprocess = (e: AudioProcessingEvent) => {
      if (this.isMuted) return;

      // Push to Talk モードの場合、ボタンを押している間のみ送信
      if (this.isPushToTalkMode && !this.isPushToTalkActive) {
        this.options.callbacks.onVolumeChange(0, this.currentAssistantVolume);
        return;
      }

      const inputBuffer = e.inputBuffer.getChannelData(0);
      
      // 計算して音量をUIに通知
      let sum = 0;
      for (let i = 0; i < inputBuffer.length; i++) {
        sum += inputBuffer[i] * inputBuffer[i];
      }
      const rms = Math.min(1, Math.sqrt(sum / inputBuffer.length) * 5);
      this.options.callbacks.onVolumeChange(rms, this.currentAssistantVolume);

      // 16kHz PCM にダウンサンプリングして WebSocket に送信
      const downsampled16k = this.downsampleTo16k(inputBuffer, this.audioContext!.sampleRate);
      const pcm16 = this.floatTo16BitPCM(downsampled16k);
      const base64Data = this.arrayBufferToBase64(pcm16.buffer);

      this.sendRealtimeChunk(base64Data);
    };

    this.audioInputNode.connect(this.processorNode);
    this.processorNode.connect(this.audioContext.destination);
  }

  private sendRealtimeChunk(base64Audio: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const realtimeMsg = {
      realtimeInput: {
        mediaChunks: [
          {
            mimeType: 'audio/pcm;rate=16000',
            data: base64Audio,
          },
        ],
      },
    };

    this.ws.send(JSON.stringify(realtimeMsg));
  }

  /**
   * Gemini からの受信メッセージ処理 (24kHz PCM Audio & Transcripts)
   */
  private async handleIncomingMessage(rawData: any): Promise<void> {
    try {
      let jsonStr = '';
      if (typeof rawData === 'string') {
        jsonStr = rawData;
      } else if (rawData instanceof Blob) {
        jsonStr = await rawData.text();
      } else if (rawData instanceof ArrayBuffer) {
        jsonStr = new TextDecoder().decode(rawData);
      }

      if (!jsonStr) return;
      const data = JSON.parse(jsonStr);

      const serverContent = data.serverContent;
      if (!serverContent) return;

      // 1. 割り込み検知 (Barge-in: ユーザーが喋り始めたため再生停止)
      if (serverContent.interrupted) {
        this.stopAssistantAudioPlayback();
        this.options.callbacks.onInterrupted();
        return;
      }

      // 2. モデルの発話データ (音声 & テキスト)
      const modelTurn = serverContent.modelTurn;
      if (modelTurn && Array.isArray(modelTurn.parts)) {
        for (const part of modelTurn.parts) {
          // 音声ストリーム (24kHz PCM)
          if (part.inlineData && part.inlineData.data) {
            const base64Pcm = part.inlineData.data;
            this.playAssistantPcm24k(base64Pcm);
          }
          // 文字起こしストリーム
          if (part.text) {
            this.options.callbacks.onAssistantTranscript(part.text);
          }
        }
      }

      // 3. ターン完了
      if (serverContent.turnComplete) {
        this.options.callbacks.onTurnComplete();
      }
    } catch (e) {
      console.warn('Error handling Gemini Live incoming message:', e);
    }
  }

  /**
   * 受信した 24kHz 16-bit Mono PCM を Web Audio API でリアルタイム順次再生
   */
  private playAssistantPcm24k(base64Data: string): void {
    if (!this.audioContext) return;

    try {
      const binaryStr = atob(base64Data);
      const len = binaryStr.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }

      const int16Array = new Int16Array(bytes.buffer);
      const float32Array = new Float32Array(int16Array.length);
      for (let i = 0; i < int16Array.length; i++) {
        float32Array[i] = int16Array[i] / 32768.0;
      }

      const audioBuffer = this.audioContext.createBuffer(1, float32Array.length, 24000);
      audioBuffer.copyToChannel(float32Array, 0);

      const sourceNode = this.audioContext.createBufferSource();
      sourceNode.buffer = audioBuffer;
      sourceNode.connect(this.audioContext.destination);

      const currentTime = this.audioContext.currentTime;
      const startTime = Math.max(currentTime, this.nextPlaybackTime);
      sourceNode.start(startTime);
      this.nextPlaybackTime = startTime + audioBuffer.duration;

      this.playbackQueue.push(sourceNode);
      sourceNode.onended = () => {
        const idx = this.playbackQueue.indexOf(sourceNode);
        if (idx >= 0) this.playbackQueue.splice(idx, 1);
      };
    } catch (e) {
      console.warn('Failed to play assistant PCM chunk:', e);
    }
  }

  private stopAssistantAudioPlayback(): void {
    for (const node of this.playbackQueue) {
      try {
        node.stop();
        node.disconnect();
      } catch (e) {}
    }
    this.playbackQueue = [];
    if (this.audioContext) {
      this.nextPlaybackTime = this.audioContext.currentTime;
    }
  }

  // ===================== CONTROL METHODS =====================
  public setPushToTalkMode(enabled: boolean): void {
    this.isPushToTalkMode = enabled;
    if (!enabled) {
      this.isPushToTalkActive = false;
    }
  }

  public setPushToTalkActive(active: boolean): void {
    this.isPushToTalkActive = active;
  }

  public setMuted(muted: boolean): void {
    this.isMuted = muted;
  }

  public sendTextPrompt(text: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const msg = {
      realtimeInput: {
        mediaChunks: [],
      },
      clientContent: {
        turns: [
          {
            role: 'user',
            parts: [{ text }],
          },
        ],
        turnComplete: true,
      },
    };
    this.ws.send(JSON.stringify(msg));
  }

  public disconnect(): void {
    this.updateState('disconnected');
    this.stopAssistantAudioPlayback();

    if (this.processorNode) {
      this.processorNode.disconnect();
      this.processorNode = null;
    }
    if (this.audioInputNode) {
      this.audioInputNode.disconnect();
      this.audioInputNode = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private updateState(state: CallConnectionState, errorMsg?: string): void {
    this.connectionState = state;
    this.options.callbacks.onStateChange(state, errorMsg);
  }

  // ===================== AUDIO HELPERS =====================
  private downsampleTo16k(input: Float32Array, inputRate: number): Float32Array {
    if (inputRate === 16000) return input;
    const ratio = inputRate / 16000;
    const newLength = Math.round(input.length / ratio);
    const result = new Float32Array(newLength);
    for (let i = 0; i < newLength; i++) {
      const idx = Math.round(i * ratio);
      result[i] = input[Math.min(idx, input.length - 1)];
    }
    return result;
  }

  private floatTo16BitPCM(input: Float32Array): Int16Array {
    const output = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      output[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return output;
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
}
