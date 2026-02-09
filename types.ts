export interface Point { x: number; y: number; }

export enum AppStep {
  IDLE = 'IDLE',
  CAPTURE = 'CAPTURE',
  CROP = 'CROP',
  REVIEW = 'REVIEW',
  EDIT = 'EDIT',
  TOOLS = 'TOOLS',
  FINAL_PREVIEW = 'FINAL_PREVIEW',
  HISTORY = 'HISTORY'
}

export type FilterType = 'none' | 'clean' | 'grayscale' | 'high-contrast' | 'vibrant' | 'magic' | 'no-shadow' | 'bw';

export interface PageData {
  id: string;
  original: string; // The raw capture
  cropped: string;  // The image after perspective crop
  processed: string; // The final image with filters
  processing: ProcessingState;
  cropPoints?: Point[]; // 4 points for perspective
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
  removeShadows: boolean;
  rotation: number; // 0, 90, 180, 270
}

export interface StampInstance {
  id: string;
  type: 'custom' | 'paid' | 'urgent' | 'pending';
  x: number;
  y: number;
  scale: number;
  imageUrl?: string; // For custom signature/stamp
}
