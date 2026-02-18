import React from 'react';
import { GeneratedImage } from '../types';
import { Trash2, Edit3, Calendar } from 'lucide-react';

interface GalleryProps {
  images: GeneratedImage[];
  onSelect: (image: GeneratedImage) => void;
  onDelete: (id: string) => void;
}

export const Gallery: React.FC<GalleryProps> = ({ images, onSelect, onDelete }) => {
  if (images.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-500">
        <div className="w-24 h-24 bg-slate-800 rounded-full flex items-center justify-center mb-6">
          <Calendar size={40} className="opacity-50" />
        </div>
        <h3 className="text-xl font-bold text-slate-400 mb-2">Gallery Empty</h3>
        <p className="max-w-md text-center">You haven't generated any images yet. Head over to the Generator to create your first masterpiece with Nano Banana.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white">Your Creations</h2>
        <span className="text-slate-400 text-sm bg-slate-800 px-3 py-1 rounded-full">{images.length} images</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {images.map((image) => (
          <div 
            key={image.id} 
            className="group relative bg-slate-800 rounded-xl overflow-hidden border border-slate-700 shadow-lg hover:shadow-2xl hover:border-yellow-500/50 transition-all duration-300"
          >
            <div className="aspect-square w-full overflow-hidden bg-slate-900 relative">
               {/* 
                  Since we store base64, loading is instant. 
                  However, purely for layout stability, object-cover is used.
               */}
              <img 
                src={image.url} 
                alt={image.prompt} 
                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" 
              />
              
              {/* Overlay on hover */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-4">
                 <div className="flex gap-2 justify-center mb-2">
                    <button 
                      onClick={(e) => { e.stopPropagation(); onSelect(image); }}
                      className="bg-yellow-500 hover:bg-yellow-400 text-black p-2 rounded-full transform hover:scale-110 transition-transform"
                      title="Edit in Studio"
                    >
                      <Edit3 size={18} />
                    </button>
                    <button 
                      onClick={(e) => { e.stopPropagation(); onDelete(image.id); }}
                      className="bg-red-500 hover:bg-red-400 text-white p-2 rounded-full transform hover:scale-110 transition-transform"
                      title="Delete"
                    >
                      <Trash2 size={18} />
                    </button>
                 </div>
              </div>
            </div>

            <div className="p-4">
              <p className="text-sm text-slate-300 line-clamp-2 mb-2 font-medium" title={image.prompt}>
                {image.prompt}
              </p>
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>{new Date(image.timestamp).toLocaleDateString()}</span>
                <span className="uppercase border border-slate-700 px-1.5 py-0.5 rounded">{image.aspectRatio}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};