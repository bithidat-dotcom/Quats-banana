import React, { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { Generator } from './components/Generator';
import { Gallery } from './components/Gallery';
import { Editor } from './components/Editor';
import { GeneratedImage, ViewMode } from './types';
import { ExternalLink, Palette, Sparkles, LayoutGrid } from 'lucide-react';

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<ViewMode>('generate');
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [selectedImage, setSelectedImage] = useState<GeneratedImage | null>(null);

  // Load from local storage "database" on mount
  useEffect(() => {
    const saved = localStorage.getItem('bananagen_db');
    if (saved) {
      try {
        setImages(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to parse database", e);
      }
    }
  }, []);

  // Save to local storage whenever images change
  useEffect(() => {
    localStorage.setItem('bananagen_db', JSON.stringify(images));
  }, [images]);

  const handleImageGenerated = (newImage: GeneratedImage) => {
    setImages(prev => [newImage, ...prev]);
    setCurrentView('editor');
    setSelectedImage(newImage);
  };

  const handleSelectImage = (image: GeneratedImage) => {
    setSelectedImage(image);
    setCurrentView('editor');
  };

  const handleDeleteImage = (id: string) => {
    setImages(prev => prev.filter(img => img.id !== id));
    if (selectedImage?.id === id) {
      setSelectedImage(null);
      setCurrentView('gallery');
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-900 text-white selection:bg-yellow-500 selection:text-black">
      <Header currentView={currentView} onViewChange={setCurrentView} />

      <main className="flex-1 container mx-auto px-4 py-8 max-w-7xl">
        {currentView === 'generate' && (
          <Generator onImageGenerated={handleImageGenerated} />
        )}

        {currentView === 'gallery' && (
          <Gallery 
            images={images} 
            onSelect={handleSelectImage} 
            onDelete={handleDeleteImage}
          />
        )}

        {currentView === 'editor' && selectedImage && (
          <Editor 
            image={selectedImage} 
            onBack={() => setCurrentView('gallery')}
            onImageSave={handleImageGenerated}
          />
        )}
        
        {/* Empty state for editor if accessed directly without selection */}
        {currentView === 'editor' && !selectedImage && (
          <div className="text-center py-20">
            <Palette className="w-16 h-16 mx-auto text-slate-600 mb-4" />
            <h2 className="text-2xl font-bold text-slate-400">No image selected</h2>
            <p className="text-slate-500 mb-6">Select an image from the gallery or generate a new one.</p>
            <button 
              onClick={() => setCurrentView('generate')}
              className="bg-yellow-500 hover:bg-yellow-400 text-black font-bold py-2 px-6 rounded-full transition-colors"
            >
              Go to Generator
            </button>
          </div>
        )}
      </main>

      <footer className="border-t border-slate-800 py-6 mt-12 bg-slate-950">
        <div className="container mx-auto px-4 text-center text-slate-500 text-sm">
          <p className="flex items-center justify-center gap-2 mb-2">
            Powered by <span className="text-yellow-500 font-semibold flex items-center gap-1"><Sparkles size={14}/> Nano Banana System</span>
          </p>
          <p>© {new Date().getFullYear()} BananaGen AI Studio. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
};

export default App;