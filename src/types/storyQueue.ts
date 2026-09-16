import { GenerateStoryParams } from '../services/gemini';
import { Story } from './story';

export type StoryQueueStatus = 'pending' | 'generating' | 'completed' | 'failed' | 'cancelled';

export interface StoryQueueTask {
  id: string;
  title: string;
  topic?: string;
  seriesId?: string;
  parentStoryId?: string;
  seriesType: 'single' | 'continuous' | 'omnibus';
  storyCount: number;
  currentEpisodeIndex: number;
  totalEpisodes: number;
  status: StoryQueueStatus;
  progressMessage?: string;
  params: GenerateStoryParams & {
    storyCount?: number;
    isContinuous?: boolean;
  };
  generatedStoryIds?: string[];
  generatedStories?: Story[];
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}
