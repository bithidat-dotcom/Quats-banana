export type ViewMode = 'generate' | 'gallery' | 'editor';

export interface GeneratedImage {
  id: string;
  url: string; // Base64 data URL
  prompt: string;
  aspectRatio: string;
  timestamp: number;
  model: string;
}

export type AspectRatio = "1:1" | "3:4" | "4:3" | "9:16" | "16:9";

export const ASPECT_RATIOS: AspectRatio[] = ["1:1", "3:4", "4:3", "9:16", "16:9"];

export interface GeminiError {
  message: string;
  status?: number;
}