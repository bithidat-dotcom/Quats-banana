import React from 'react';
import { Sparkles, Image as ImageIcon, LayoutGrid, Banana } from 'lucide-react';
import { ViewMode } from '../types';

interface HeaderProps {
  currentView: ViewMode;
  onViewChange: (view: ViewMode) => void;
}

export const Header: React.FC<HeaderProps> = ({ currentView, onViewChange }) => {
  const navItemClass = (view: ViewMode) => `
    flex items-center gap-2 px-4 py-2 rounded-full transition-all duration-200
    ${currentView === view 
      ? 'bg-yellow-500 text-black font-semibold shadow-lg shadow-yellow-500/20' 
      : 'text-slate-400 hover:text-white hover:bg-slate-800'}
  `;

  return (
    <header className="sticky top-0 z-50 bg-slate-900/80 backdrop-blur-md border-b border-slate-800">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <div 
          className="flex items-center gap-3 cursor-pointer group" 
          onClick={() => onViewChange('generate')}
        >
          <div className="bg-gradient-to-br from-yellow-400 to-orange-500 p-2 rounded-lg group-hover:scale-110 transition-transform">
            <Banana className="text-black w-6 h-6 fill-current" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white">BananaGen</h1>
            <p className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">Nano System</p>
          </div>
        </div>

        <nav className="flex items-center gap-2">
          <button 
            onClick={() => onViewChange('generate')}
            className={navItemClass('generate')}
          >
            <Sparkles size={18} />
            <span className="hidden sm:inline">Generate</span>
          </button>
          
          <button 
            onClick={() => onViewChange('gallery')}
            className={navItemClass('gallery')}
          >
            <LayoutGrid size={18} />
            <span className="hidden sm:inline">Gallery</span>
          </button>

          {/* Editor tab is only active if explicitly selected, but we show it for consistency if active */}
          {currentView === 'editor' && (
            <button 
              className={navItemClass('editor')}
            >
              <ImageIcon size={18} />
              <span className="hidden sm:inline">Editor</span>
            </button>
          )}
        </nav>
      </div>
    </header>
  );
};