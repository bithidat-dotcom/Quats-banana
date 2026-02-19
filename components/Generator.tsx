import React, { useState } from 'react';
import { GeneratedImage, ASPECT_RATIOS, AspectRatio } from '../types';
import { generateImageWithGemini } from '../services/geminiService';
import { Button } from './Button';
import { Wand2, AlertCircle, Ratio, Info } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';

interface GeneratorProps {
  onImageGenerated: (image: GeneratedImage) => void;
}

export const Generator: React.FC<GeneratorProps> = ({ onImageGenerated }) => {
  const [prompt, setPrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('1:1');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const imageUrl = await generateImageWithGemini(prompt, aspectRatio);
      
      const newImage: GeneratedImage = {
        id: uuidv4(),
        url: imageUrl,
        prompt: prompt,
        aspectRatio,
        timestamp: Date.now(),
        model: 'gemini-2.5-flash-image'
      };

      onImageGenerated(newImage);
      setPrompt(''); // Clear prompt on success? Or keep it? Let's clear for fresh start.
    } catch (err: any) {
      setError(err.message || "Something went wrong while generating the image.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto w-full space-y-8 animate-fade-in">
      <div className="text-center space-y-4">
        <h2 className="text-4xl md:text-5xl font-extrabold bg-clip-text text-transparent bg-gradient-to-r from-yellow-200 via-yellow-400 to-yellow-600 pb-2">
          Dream it. Generate it.
        </h2>
        <p className="text-slate-400 text-lg max-w-xl mx-auto">
          Unleash the power of the <span className="text-yellow-400 font-semibold">Nano Banana System</span> to create stunning visuals from simple text descriptions.
        </p>
      </div>

      <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700 rounded-2xl p-6 md:p-8 shadow-xl">
        <form onSubmit={handleGenerate} className="space-y-6">
          
          <div className="space-y-2">
            <label htmlFor="prompt" className="block text-sm font-medium text-slate-300">
              Your Prompt
            </label>
            <div className="relative">
              <textarea
                id="prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="A futuristic city built on a giant banana floating in space, cyberpunk style, neon lights..."
                className="w-full h-32 bg-slate-900 border border-slate-700 rounded-xl p-4 text-white placeholder-slate-500 focus:ring-2 focus:ring-yellow-500 focus:border-transparent transition-all resize-none text-lg"
                disabled={loading}
              />
              <div className="absolute bottom-3 right-3 text-xs text-slate-600 font-mono">
                {prompt.length} chars
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-300 flex items-center gap-2">
                <Ratio size={16} /> Aspect Ratio
              </label>
              <div className="grid grid-cols-5 gap-2">
                {ASPECT_RATIOS.map((ratio) => (
                  <button
                    key={ratio}
                    type="button"
                    onClick={() => setAspectRatio(ratio)}
                    disabled={loading}
                    className={`
                      px-2 py-2 text-xs font-medium rounded-lg border transition-all
                      ${aspectRatio === ratio 
                        ? 'bg-yellow-500/10 border-yellow-500 text-yellow-400' 
                        : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-500'}
                    `}
                  >
                    {ratio}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-300 flex items-center gap-2">
                 <Info size={16}/> Model Info
              </label>
              <div className="p-3 bg-slate-900 rounded-lg border border-slate-700 flex items-center justify-between">
                <span className="text-xs text-slate-400">System</span>
                <span className="text-xs font-bold text-yellow-500 bg-yellow-900/20 px-2 py-1 rounded">Nano Banana v2.5</span>
              </div>
              <p className="text-[10px] text-slate-500 mt-1">
                Optimized for speed and high fidelity generation.
              </p>
            </div>
          </div>

          {error && (
            <div className="p-4 bg-red-900/20 border border-red-500/50 rounded-lg flex items-start gap-3 text-red-200">
              <AlertCircle className="shrink-0 mt-0.5" size={18} />
              <p className="text-sm">{error}</p>
            </div>
          )}

          <Button 
            type="submit" 
            variant="primary" 
            className="w-full text-lg py-4 shadow-lg shadow-yellow-500/10 hover:shadow-yellow-500/20"
            isLoading={loading}
            disabled={!prompt.trim()}
            icon={<Wand2 size={20} />}
          >
            {loading ? 'Dreaming...' : 'Generate Image'}
          </Button>

        </form>
      </div>

      <div className="flex justify-center gap-6 text-slate-600 text-sm">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-500"></div>
          <span>Fast Generation</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-blue-500"></div>
          <span>High Fidelity</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-purple-500"></div>
          <span>Commercial Use</span>
        </div>
      </div>
    </div>
  );
};