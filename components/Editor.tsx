import React, { useRef, useState, useEffect } from 'react';
import { GeneratedImage } from '../types';
import { Button } from './Button';
import { Download, ArrowLeft, Move, Type as TypeIcon, Wand2, Paintbrush, Layers, AlertCircle } from 'lucide-react';
import { editImageWithGemini } from '../services/geminiService';

interface EditorProps {
  image: GeneratedImage;
  onBack: () => void;
  onImageSave: (image: GeneratedImage) => void;
}

type EditorMode = 'canvas' | 'ai';

const generateId = () => Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

export const Editor: React.FC<EditorProps> = ({ image, onBack, onImageSave }) => {
  const [mode, setMode] = useState<EditorMode>('canvas');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Canvas State
  const [text, setText] = useState('');
  const [fontSize, setFontSize] = useState(48);
  const [textColor, setTextColor] = useState('#ffffff');
  const [textPos, setTextPos] = useState({ x: 50, y: 50 }); // Percentage
  
  // AI Edit State
  const [editPrompt, setEditPrompt] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = image.url;
    
    img.onload = () => {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      drawCanvas();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image.url]);

  // Redraw when properties change
  useEffect(() => {
    drawCanvas();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, fontSize, textColor, textPos, mode]);

  const drawCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.src = image.url;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);

    if (text && mode === 'canvas') {
      ctx.fillStyle = textColor;
      ctx.font = `bold ${fontSize}px Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.shadowColor = 'rgba(0,0,0,0.7)';
      ctx.shadowBlur = 10;
      ctx.shadowOffsetX = 2;
      ctx.shadowOffsetY = 2;

      const x = (canvas.width * textPos.x) / 100;
      const y = (canvas.height * textPos.y) / 100;

      ctx.fillText(text, x, y);
    }
  };

  const handleDownload = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const link = document.createElement('a');
    link.download = `bananagen-${image.id}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (mode !== 'canvas' || !text) return;

    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    
    setTextPos({ x, y });
  };

  const handleAiEdit = async () => {
    if (!editPrompt.trim()) return;
    setIsProcessing(true);
    setError(null);

    try {
      // For editing, we send the current raw image (without canvas text) to the API
      const newImageUrl = await editImageWithGemini(image.url, editPrompt);
      
      const newImage: GeneratedImage = {
        id: generateId(),
        url: newImageUrl,
        prompt: `Edit of "${image.prompt}": ${editPrompt}`,
        aspectRatio: image.aspectRatio, // Persist aspect ratio logic
        timestamp: Date.now(),
        model: 'gemini-2.5-flash-image'
      };

      onImageSave(newImage);
      setEditPrompt('');
      // Mode will stay AI or switch to canvas? Let's stay in AI to see result, or user can switch.
    } catch (err: any) {
      setError(err.message || "Failed to edit image");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="h-full flex flex-col lg:flex-row gap-6 animate-fade-in">
      {/* Sidebar Controls */}
      <div className="w-full lg:w-80 flex flex-col gap-6 order-2 lg:order-1">
        <div className="flex items-center gap-2 mb-2">
          <Button variant="ghost" onClick={onBack} className="!px-2">
            <ArrowLeft size={20} />
          </Button>
          <h2 className="text-xl font-bold">Studio Editor</h2>
        </div>

        {/* Tabs */}
        <div className="flex bg-slate-800 p-1 rounded-lg">
          <button
            onClick={() => setMode('canvas')}
            className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-all ${mode === 'canvas' ? 'bg-slate-700 text-white shadow' : 'text-slate-400 hover:text-white'}`}
          >
            <TypeIcon size={16} /> Text Overlay
          </button>
          <button
            onClick={() => setMode('ai')}
            className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-all ${mode === 'ai' ? 'bg-yellow-500 text-black shadow' : 'text-slate-400 hover:text-white'}`}
          >
            <Wand2 size={16} /> AI Edit
          </button>
        </div>

        {mode === 'canvas' ? (
          <div className="bg-slate-800 rounded-xl p-5 border border-slate-700 space-y-5 animate-fade-in">
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-400 flex items-center gap-2">
                <Layers size={16}/> Caption Text
              </label>
              <input
                type="text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Enter text..."
                className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-yellow-500 outline-none"
              />
            </div>

            {text && (
              <>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-400">Size: {fontSize}px</label>
                  <input
                    type="range"
                    min="20"
                    max="200"
                    value={fontSize}
                    onChange={(e) => setFontSize(Number(e.target.value))}
                    className="w-full accent-yellow-500 h-2 bg-slate-900 rounded-lg appearance-none cursor-pointer"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-400">Color</label>
                  <div className="flex gap-2 flex-wrap">
                    {['#ffffff', '#000000', '#f59e0b', '#ef4444', '#3b82f6', '#10b981'].map(color => (
                      <button
                        key={color}
                        onClick={() => setTextColor(color)}
                        className={`w-8 h-8 rounded-full border-2 ${textColor === color ? 'border-white scale-110' : 'border-transparent'} shadow-sm`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>
                
                <div className="text-xs text-slate-500 bg-slate-900/50 p-3 rounded border border-slate-700/50">
                  <p className="flex items-center gap-2">
                    <Move size={12}/> Click on image to move text.
                  </p>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="bg-slate-800 rounded-xl p-5 border border-slate-700 space-y-5 animate-fade-in">
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-400 flex items-center gap-2">
                <Paintbrush size={16}/> Edit Instruction
              </label>
              <textarea
                value={editPrompt}
                onChange={(e) => setEditPrompt(e.target.value)}
                placeholder="E.g., 'Make it night time', 'Add a red hat to the character', 'Turn into a sketch'..."
                className="w-full h-32 bg-slate-900 border border-slate-700 rounded-lg p-3 text-white placeholder-slate-500 focus:ring-2 focus:ring-yellow-500 outline-none resize-none"
                disabled={isProcessing}
              />
            </div>

            {error && (
              <div className="p-3 bg-red-900/20 border border-red-500/50 rounded text-xs text-red-200 flex items-start gap-2">
                <AlertCircle size={14} className="mt-0.5 shrink-0"/>
                {error}
              </div>
            )}

            <Button 
              variant="primary" 
              onClick={handleAiEdit} 
              isLoading={isProcessing}
              disabled={!editPrompt.trim()}
              className="w-full"
              icon={<Wand2 size={18} />}
            >
              {isProcessing ? 'Editing...' : 'Generate Edit'}
            </Button>
            
            <p className="text-xs text-slate-500 text-center">
              This will create a new version of your image.
            </p>
          </div>
        )}

        <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
           <h3 className="text-sm font-medium text-slate-400 mb-2">Image Info</h3>
           <p className="text-xs text-slate-300 italic p-3 bg-slate-900 rounded border border-slate-700/50 max-h-24 overflow-y-auto">
             "{image.prompt}"
           </p>
        </div>

        <div className="mt-auto">
          <Button 
             variant="secondary" 
             onClick={handleDownload} 
             className="w-full py-3 border border-slate-600"
             icon={<Download size={18} />}
          >
            Download {mode === 'canvas' ? 'Canvas' : 'Image'}
          </Button>
        </div>
      </div>

      {/* Canvas Area */}
      <div className="flex-1 bg-black/40 rounded-2xl flex items-center justify-center p-4 lg:p-10 border border-slate-800 overflow-hidden order-1 lg:order-2">
        <div className="relative shadow-2xl shadow-black/50">
          {mode === 'ai' && isProcessing && (
             <div className="absolute inset-0 z-10 bg-black/50 backdrop-blur-sm flex items-center justify-center rounded-lg">
                <div className="text-center">
                  <div className="w-12 h-12 border-4 border-yellow-500 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
                  <p className="text-yellow-500 font-medium animate-pulse">Processing Edit...</p>
                </div>
             </div>
          )}
          <canvas
            ref={canvasRef}
            onClick={handleCanvasClick}
            className={`max-w-full max-h-[70vh] w-auto h-auto rounded-lg ${mode === 'canvas' && text ? 'cursor-crosshair' : 'cursor-default'}`}
          />
        </div>
      </div>
    </div>
  );
};