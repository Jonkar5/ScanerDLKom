
export enum AppStep {
  IDLE = 'IDLE',
  CAPTURE = 'CAPTURE',
  REVIEW = 'REVIEW',
  EDIT = 'EDIT',
  FINAL_PREVIEW = 'FINAL_PREVIEW',
  HISTORY = 'HISTORY'
}

export type FilterType = 'none' | 'clean' | 'grayscale' | 'high-contrast' | 'vibrant';

export interface PageData {
  id: string;
  original: string;
  processed: string;
  processing: ProcessingState;
}

export interface ScanResult {
  id: string;
  pages: string[]; // Final processed images
  ocrText: string;
  category: string;
  timestamp: number;
  fileName: string;
  isQuestionnaire?: boolean;
}

export interface ProcessingState {
  brightness: number;
  contrast: number;
  saturation: number;
  filter: FilterType;
  stamps?: StampInstance[];
}

export interface StampInstance {
  id: string;
  type: 'custom' | 'paid' | 'urgent' | 'pending';
  x: number;
  y: number;
  scale: number;
  imageUrl?: string; // For custom signature/stamp
}
