import { GoogleGenAI } from "@google/genai";
import { AspectRatio } from "../types";

export const generateImageWithGemini = async (
  prompt: string, 
  aspectRatio: AspectRatio
): Promise<string> => {
  if (!process.env.API_KEY) {
    throw new Error("API Key is missing. Please configure your environment.");
  }

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  try {
    // Using the "Nano Banana" equivalent model: gemini-2.5-flash-image
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [
          { text: prompt },
        ],
      },
      config: {
        imageConfig: {
          aspectRatio: aspectRatio,
        }
      },
    });

    return extractImageFromResponse(response);

  } catch (error: any) {
    console.error("Gemini API Error:", error);
    throw new Error(error.message || "Failed to generate image.");
  }
};

export const editImageWithGemini = async (
  base64Image: string,
  prompt: string
): Promise<string> => {
  if (!process.env.API_KEY) {
    throw new Error("API Key is missing.");
  }

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  // Extract raw base64 and mimeType from data URL
  const matches = base64Image.match(/^data:(.+);base64,(.+)$/);
  if (!matches || matches.length !== 3) {
    throw new Error("Invalid image format. Expected data URL.");
  }
  const mimeType = matches[1];
  const data = matches[2];

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [
          { 
            inlineData: {
              mimeType,
              data
            } 
          },
          { text: prompt },
        ],
      },
      // We don't strictly enforce aspect ratio here to let the model follow the input image structure
      // unless we wanted to resize/crop.
    });

    return extractImageFromResponse(response);

  } catch (error: any) {
    console.error("Gemini Edit Error:", error);
    throw new Error(error.message || "Failed to edit image.");
  }
};

// Helper to extract image data
const extractImageFromResponse = (response: any): string => {
  if (response.candidates && response.candidates.length > 0) {
    const parts = response.candidates[0].content?.parts;
    if (parts) {
      for (const part of parts) {
        if (part.inlineData && part.inlineData.data) {
          const base64Data = part.inlineData.data;
          const mimeType = part.inlineData.mimeType || 'image/png';
          return `data:${mimeType};base64,${base64Data}`;
        }
      }
    }
  }
  throw new Error("No image data found in the response.");
};