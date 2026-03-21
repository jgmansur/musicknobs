import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Globe } from 'lucide-react';
import AppEs from './AppEs';
import AppEn from './AppEn';

export default function App() {
  const [lang, setLang] = useState('es');

  return (
    <>
      <div className="fixed bottom-6 right-6 z-50">
        <button 
          onClick={() => setLang(lang === 'es' ? 'en' : 'es')}
          className="group flex items-center justify-center gap-2 bg-black/40 backdrop-blur-md border border-white/10 text-white/70 px-4 py-2 rounded-full hover:bg-black/60 hover:text-white hover:border-brand-gold/50 transition-all font-medium text-xs tracking-widest shadow-lg"
        >
          <Globe size={14} className="group-hover:text-brand-gold group-hover:animate-spin-slow transition-colors" />
          <span>{lang === 'es' ? 'EN' : 'ES'}</span>
        </button>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={lang}
          initial={{ opacity: 0, filter: 'blur(10px)' }}
          animate={{ opacity: 1, filter: 'blur(0px)' }}
          exit={{ opacity: 0, filter: 'blur(10px)' }}
          transition={{ duration: 0.5 }}
        >
          {lang === 'es' ? <AppEs /> : <AppEn />}
        </motion.div>
      </AnimatePresence>
    </>
  );
}
