import React, { useRef, useState, useEffect, useMemo } from 'react';
import { GeneratedImage } from '../types';
import { Button } from './Button';
import { Download, ArrowLeft, Move, Type as TypeIcon, Wand2, Paintbrush, Layers, AlertCircle, History, Sliders, Sun, Contrast, Palette } from 'lucide-react';
import { editImageWithGemini } from '../services/geminiService';
import { v4 as uuidv4 } from 'uuid';

interface EditorProps {
  image: GeneratedImage;
  allImages?: GeneratedImage[];
  onBack: () => void;
  onImageSave: (image: GeneratedImage) => void;
  onSelectHistoryImage?: (image: GeneratedImage) => void;
}

type EditorMode = 'canvas' | 'filters' | 'ai' | 'history';

export const Editor: React.FC<EditorProps> = ({ image, allImages = [], onBack, onImageSave, onSelectHistoryImage }) => {
  const [mode, setMode] = useState<EditorMode>('ai');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Canvas Text State
  const [text, setText] = useState('');
  const [fontSize, setFontSize] = useState(48);
  const [textColor, setTextColor] = useState('#ffffff');
  const [textPos, setTextPos] = useState({ x: 50, y: 50 }); // Percentage
  
  // Filter State
  const [filters, setFilters] = useState({
    brightness: 100,
    contrast: 100,
    grayscale: 0,
    sepia: 0,
    saturate: 100,
  });

  // AI Edit State
  const [editPrompt, setEditPrompt] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Compute history lineage
  const historyLineage = useMemo(() => {
    const lineage: GeneratedImage[] = [];
    const visited = new Set<string>();
    
    // Simple approach: Find all images that are in the same 'tree'
    // For a robust tree, we'd need a recursive search up and down.
    // Let's just find the path UP from current, and any immediate children of current.
    
    // 1. Trace back parents
    let curr: GeneratedImage | undefined = image;
    while (curr) {
      if (visited.has(curr.id)) break;
      visited.add(curr.id);
      lineage.unshift(curr);
      if (curr.parentId) {
        const pid = curr.parentId; // Renamed local variable to avoid TS shadowing error
        curr = allImages.find(img => img.id === pid);
      } else {
        curr = undefined;
      }
    }

    // 2. Find children of the current image (one level down for simplicity in this view)
    const children = allImages.filter(img => img.parentId === image.id);
    children.forEach(child => {
        if (!visited.has(child.id)) {
            lineage.push(child);
        }
    });
    
    // Sort by timestamp to make a clean timeline
    return lineage.sort((a, b) => a.timestamp - b.timestamp);
  }, [image, allImages]);


  // Initialize and Draw Canvas
  useEffect(() => {
    drawCanvas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image.url, text, fontSize, textColor, textPos, filters]);

  const drawCanvas = () => {
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
      
      // Apply filters
      ctx.filter = `brightness(${filters.brightness}%) contrast(${filters.contrast}%) grayscale(${filters.grayscale}%) sepia(${filters.sepia}%) saturate(${filters.saturate}%)`;
      
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      
      // Reset filter for text
      ctx.filter = 'none';

      if (text) {
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
      // Get current canvas state as base64 for the edit source
      // This allows filters and text to be "baked in" to the AI edit if desired
      // OR we can just use the raw image.url. 
      // Using canvasRef allows chaining edits (e.g. filter -> AI edit).
      const sourceImage = canvasRef.current ? canvasRef.current.toDataURL('image/png') : image.url;

      const newImageUrl = await editImageWithGemini(sourceImage, editPrompt);
      
      const newImage: GeneratedImage = {
        id: uuidv4(),
        url: newImageUrl,
        prompt: `Edit: ${editPrompt}`,
        aspectRatio: image.aspectRatio,
        timestamp: Date.now(),
        model: 'gemini-2.5-flash-image',
        parentId: image.id // Link to current image
      };

      onImageSave(newImage);
      setEditPrompt('');
    } catch (err: any) {
      setError(err.message || "Failed to edit image");
    } finally {
      setIsProcessing(false);
    }
  };

  const resetFilters = () => {
    setFilters({
      brightness: 100,
      contrast: 100,
      grayscale: 0,
      sepia: 0,
      saturate: 100,
    });
  };

  return (
    <div className="h-full flex flex-col lg:flex-row gap-6 animate-fade-in">
      {/* Sidebar Controls */}
      <div className="w-full lg:w-96 flex flex-col gap-6 order-2 lg:order-1">
        <div className="flex items-center gap-2 mb-2">
          <Button variant="ghost" onClick={onBack} className="!px-2">
            <ArrowLeft size={20} />
          </Button>
          <h2 className="text-xl font-bold">Studio Editor</h2>
        </div>

        {/* Tabs */}
        <div className="flex bg-slate-800 p-1 rounded-lg overflow-x-auto">
          {[
            { id: 'ai', icon: Wand2, label: 'AI Edit' },
            { id: 'filters', icon: Sliders, label: 'Filters' },
            { id: 'canvas', icon: TypeIcon, label: 'Text' },
            { id: 'history', icon: History, label: 'History' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setMode(tab.id as EditorMode)}
              className={`flex-1 min-w-[80px] flex flex-col items-center justify-center gap-1 py-2 rounded-md text-xs font-medium transition-all ${mode === tab.id ? 'bg-yellow-500 text-black shadow' : 'text-slate-400 hover:text-white hover:bg-slate-700'}`}
            >
              <tab.icon size={18} />
              {tab.label}
            </button>
          ))}
        </div>

        {/* CANVAS TEXT MODE */}
        {mode === 'canvas' && (
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
        )}

        {/* FILTERS MODE */}
        {mode === 'filters' && (
          <div className="bg-slate-800 rounded-xl p-5 border border-slate-700 space-y-5 animate-fade-in">
             <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-slate-300">Image Adjustments</h3>
                <button onClick={resetFilters} className="text-xs text-yellow-500 hover:text-yellow-400">Reset</button>
             </div>

             {[
               { label: 'Brightness', key: 'brightness', min: 0, max: 200, icon: Sun },
               { label: 'Contrast', key: 'contrast', min: 0, max: 200, icon: Contrast },
               { label: 'Saturation', key: 'saturate', min: 0, max: 200, icon: Palette },
               { label: 'Grayscale', key: 'grayscale', min: 0, max: 100, icon: null },
               { label: 'Sepia', key: 'sepia', min: 0, max: 100, icon: null },
             ].map((filter) => (
                <div key={filter.key} className="space-y-1">
                  <div className="flex justify-between text-xs text-slate-400">
                    <span className="flex items-center gap-1">
                      {filter.icon && <filter.icon size={12}/>} {filter.label}
                    </span>
                    <span>{filters[filter.key as keyof typeof filters]}%</span>
                  </div>
                  <input
                    type="range"
                    min={filter.min}
                    max={filter.max}
                    value={filters[filter.key as keyof typeof filters]}
                    onChange={(e) => setFilters(prev => ({ ...prev, [filter.key]: Number(e.target.value) }))}
                    className="w-full accent-yellow-500 h-1.5 bg-slate-900 rounded-lg appearance-none cursor-pointer"
                  />
                </div>
             ))}
          </div>
        )}

        {/* AI EDIT MODE */}
        {mode === 'ai' && (
          <div className="bg-slate-800 rounded-xl p-5 border border-slate-700 space-y-5 animate-fade-in">
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-400 flex items-center gap-2">
                <Paintbrush size={16}/> Edit Instruction
              </label>
              <textarea
                value={editPrompt}
                onChange={(e) => setEditPrompt(e.target.value)}
                placeholder="Describe how to change the image (e.g., 'Make it snowy', 'Add a hat', 'Change background to Mars')..."
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
              {isProcessing ? 'Thinking...' : 'Generate Edit'}
            </Button>
            
            <p className="text-xs text-slate-500 text-center">
              Uses Nano Banana System (Gemini 2.5) to reconstruct the image.
            </p>
          </div>
        )}

        {/* HISTORY MODE */}
        {mode === 'history' && (
          <div className="bg-slate-800 rounded-xl p-4 border border-slate-700 flex-1 overflow-y-auto min-h-[300px] animate-fade-in">
            <h3 className="text-sm font-medium text-slate-300 mb-4 sticky top-0 bg-slate-800 pb-2 border-b border-slate-700">Version History</h3>
            
            <div className="space-y-4 relative pl-4 border-l-2 border-slate-700 ml-2">
               {historyLineage.map((histImg, index) => (
                 <div key={histImg.id} className="relative">
                   {/* Timeline Dot */}
                   <div className={`absolute -left-[21px] top-3 w-3 h-3 rounded-full border-2 ${histImg.id === image.id ? 'bg-yellow-500 border-yellow-500' : 'bg-slate-900 border-slate-500'}`}></div>
                   
                   <div 
                     onClick={() => onSelectHistoryImage?.(histImg)}
                     className={`cursor-pointer p-3 rounded-lg border transition-all ${histImg.id === image.id ? 'bg-slate-700 border-yellow-500/50' : 'bg-slate-900 border-slate-700 hover:border-slate-600'}`}
                   >
                     <div className="flex gap-3">
                       <img src={histImg.url} alt="thumbnail" className="w-16 h-16 object-cover rounded bg-black" />
                       <div className="flex-1 min-w-0">
                         <p className="text-xs text-slate-300 line-clamp-2 font-medium">{histImg.prompt}</p>
                         <p className="text-[10px] text-slate-500 mt-1">{new Date(histImg.timestamp).toLocaleTimeString()}</p>
                       </div>
                     </div>
                   </div>
                 </div>
               ))}
               
               {historyLineage.length === 0 && (
                 <p className="text-xs text-slate-500 italic">No history available.</p>
               )}
            </div>
          </div>
        )}

        {mode !== 'history' && (
           <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
             <h3 className="text-sm font-medium text-slate-400 mb-2">Original Prompt</h3>
             <p className="text-xs text-slate-300 italic p-3 bg-slate-900 rounded border border-slate-700/50 max-h-24 overflow-y-auto">
               "{image.prompt}"
             </p>
           </div>
        )}

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
                  <p className="text-yellow-500 font-medium animate-pulse">Nano Processing...</p>
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