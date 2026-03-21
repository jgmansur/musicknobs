import React from 'react';
import { motion } from 'framer-motion';
import { MapPin, Maximize, TrendingUp, Instagram, Play } from 'lucide-react';

const GalleryImages = [
  'IMG_2261.jpg', 'IMG_2269.jpg', 'IMG_2126.jpg', 'IMG_2124.jpg', 
  'IMG_2247.jpg', 'IMG_0006.JPG', 'IMG_0018.JPG', 'IMG_0012.JPG', 
  'IMG_0011.JPG', 'IMG_0016.JPG', 'IMG_0002.JPG', 'IMG_0005.JPG'
];

// We will update these with the real YouTube IDs once the upload finishes
const VideoPlaceholders = [
  { title: "Recorrido Exclusivo", id: "LeSV9K8AsqY" },
  { title: "Reel de Interiores", id: "q46Fmi6FORA" },
  { title: "Reel de Exteriores y Amenidades", id: "cq9A3kC_B_E" },
  { title: "Vista Aérea (Dron)", id: "uYOWJLKrzZ4" }
];

function App() {
  return (
    <div className="min-h-screen bg-brand selection:bg-brand-gold/30">
      
      {/* Navbar (Mobile Friendly) */}
      <nav className="fixed top-0 w-full z-50 glass-panel py-4 px-6 flex justify-between items-center transition-all duration-300">
        <h1 className="font-display font-bold text-xl tracking-widest uppercase text-white">Casa Galería</h1>
        <a 
          href="https://www.instagram.com/casagaleriasanmiguel?igsh=NnR2N2s4anV4NzFy" 
          target="_blank" 
          rel="noreferrer"
          className="text-gray-300 hover:text-brand-gold transition flex items-center gap-2 text-sm uppercase tracking-wide"
        >
          <Instagram size={18} />
          <span className="hidden sm:inline">Instagram</span>
        </a>
      </nav>

      {/* Hero Section */}
      <section className="relative h-screen flex items-center justify-center overflow-hidden">
        <div className="absolute inset-0 z-0">
          <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/40 to-brand z-10" />
          <img 
            src={`${import.meta.env.BASE_URL}assets/IMG_2261.jpg`} 
            alt="Casa Galeria Hero" 
            className="w-full h-full object-cover object-center scale-105 animate-[slow-zoom_20s_ease-in-out_infinite_alternate]"
          />
        </div>
        
        <div className="relative z-20 text-center px-4 max-w-4xl mx-auto">
          <motion.h2 
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, delay: 0.2 }}
            className="font-display text-5xl md:text-7xl lg:text-8xl font-bold text-white mb-6 tracking-tight leading-tight"
          >
            Refugio de <br/> <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand-gold to-yellow-200">Lujo y Diseño</span>
          </motion.h2>
          <motion.p 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1, delay: 0.8 }}
            className="text-lg md:text-xl text-gray-300 font-light max-w-2xl mx-auto"
          >
            Una joya arquitectónica diseñada para inspirar, descansar y disfrutar del más alto nivel de vida.
          </motion.p>
        </div>
        
        {/* Scroll indicator */}
        <motion.div 
          animate={{ y: [0, 10, 0] }}
          transition={{ repeat: Infinity, duration: 2 }}
          className="absolute bottom-10 left-1/2 -translate-x-1/2 z-20 text-white/50"
        >
          <div className="w-[1px] h-16 bg-gradient-to-b from-brand-gold to-transparent mx-auto" />
        </motion.div>
      </section>

      {/* Details Section */}
      <section className="py-24 px-6 md:px-12 relative">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            
            <motion.div 
              initial={{ opacity: 0, x: -50 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8 }}
              className="space-y-8"
            >
              <h3 className="font-display text-4xl md:text-5xl font-semibold text-white leading-tight">
                Espacios pensados en cada detalle.
              </h3>
              <p className="text-gray-400 text-lg leading-relaxed font-light">
                Ubicada en una de las zonas más exclusivas, Residencial la Mesa del Malanquin (Hoyo 13), esta propiedad ofrece un balance perfecto entre privacidad absoluta y diseño vanguardista.
              </p>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-6">
                <div className="glass-panel p-6 rounded-2xl flex flex-col gap-3">
                  <div className="w-12 h-12 rounded-full bg-brand-gold/10 flex items-center justify-center text-brand-gold">
                    <Maximize size={24} />
                  </div>
                  <div>
                    <p className="text-sm text-gray-400 font-medium uppercase tracking-wider">Superficie Terreno</p>
                    <p className="text-2xl font-display font-semibold text-white">403.13 m²</p>
                  </div>
                </div>
                
                <div className="glass-panel p-6 rounded-2xl flex flex-col gap-3">
                  <div className="w-12 h-12 rounded-full bg-brand-gold/10 flex items-center justify-center text-brand-gold">
                    <MapPin size={24} />
                  </div>
                  <div>
                    <p className="text-sm text-gray-400 font-medium uppercase tracking-wider">Construcción</p>
                    <p className="text-2xl font-display font-semibold text-white">360 m² aprox.</p>
                  </div>
                </div>
              </div>
            </motion.div>

            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8 }}
              className="relative aspect-[4/5] rounded-3xl overflow-hidden shadow-2xl"
            >
              <img src={`${import.meta.env.BASE_URL}assets/IMG_2269.jpg`} alt="Interior Details" className="w-full h-full object-cover" />
              <div className="absolute inset-0 border border-white/10 rounded-3xl pointer-events-none" />
            </motion.div>
            
          </div>
        </div>
      </section>

      {/* Investment Section */}
      <section className="py-24 px-6 md:px-12 bg-black/50 relative border-y border-white/5">
        <div className="max-w-4xl mx-auto text-center space-y-12">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-brand-gold/10 text-brand-gold border border-brand-gold/20 mb-4"
          >
            <TrendingUp size={16} />
            <span className="text-sm font-semibold tracking-wide uppercase">Potencial de Inversión</span>
          </motion.div>
          
          <h3 className="font-display text-3xl md:text-5xl font-bold text-white mb-6">
            Historial de Rendimiento Comprobado
          </h3>
          <p className="text-gray-400 text-lg max-w-2xl mx-auto font-light">
            Anteriormente operada exitosamente en plataformas de renta a corto plazo, generando métricas excepcionales que avalan su valor como activo inmobiliario premium.
          </p>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-8 mt-12">
            {[
              { year: '2024', rev: '$269K' },
              { year: '2023', rev: '$814K' },
              { year: '2022', rev: '$1.26M', highlight: true },
              { year: '2021', rev: '$761K' },
            ].map((stat, i) => (
              <motion.div 
                key={stat.year}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className={`flex flex-col items-center justify-center p-6 rounded-2xl border ${stat.highlight ? 'bg-brand-gold/10 border-brand-gold/30' : 'bg-white/5 border-white/10'}`}
              >
                <span className="text-sm text-gray-400 mb-2 font-medium">{stat.year}</span>
                <span className={`font-display text-3xl font-bold ${stat.highlight ? 'text-brand-gold' : 'text-white'}`}>{stat.rev} <span className="text-sm font-normal text-gray-500">MXN</span></span>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Gallery Section */}
      <section className="py-24 px-4 md:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="mb-16 flex flex-col md:flex-row md:items-end justify-between gap-6">
            <div>
              <h3 className="font-display text-4xl md:text-5xl font-bold text-white mb-4">Galería</h3>
              <p className="text-gray-400 font-light">Explora cada rincón de esta obra maestra.</p>
            </div>
            <div className="h-[1px] flex-1 bg-gradient-to-r from-white/10 to-transparent hidden md:block ml-8 mb-4" />
          </div>

          <div className="columns-1 sm:columns-2 lg:columns-3 gap-4 md:gap-6 space-y-4 md:space-y-6">
            {GalleryImages.map((img, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "0px 0px -100px 0px" }}
                transition={{ duration: 0.5, delay: (i % 3) * 0.1 }}
                className="group relative rounded-2xl overflow-hidden bg-brand-light break-inside-avoid"
              >
                <img 
                  src={`${import.meta.env.BASE_URL}assets/${img}`} 
                  alt={`Casa Galeria ${i}`}
                  loading="lazy"
                  className="w-full h-auto object-cover transform transition-transform duration-700 group-hover:scale-110"
                />
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center">
                  <div className="w-12 h-12 rounded-full border border-white/30 flex items-center justify-center backdrop-blur-sm">
                    <Maximize className="text-white" size={20} />
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Video Walkthroughs */}
      <section className="py-24 px-4 md:px-8 bg-black/30">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16 space-y-4">
            <h3 className="font-display text-4xl md:text-5xl font-bold text-white">Recorridos Visuales</h3>
            <p className="text-gray-400 font-light max-w-2xl mx-auto">Experimenta la atmósfera y los detalles a través de nuestros videos cinematográficos.</p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
            {VideoPlaceholders.map((vid, i) => (
              <motion.div 
                key={i}
                initial={{ opacity: 0, scale: 0.95 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                className="glass-panel rounded-3xl overflow-hidden aspect-video relative group"
              >
                {vid.id ? (
                  <iframe 
                    src={`https://www.youtube.com/embed/${vid.id}?rel=0&showinfo=0&autoplay=0&controls=1&modestbranding=1`}
                    title={vid.title}
                    className="w-full h-full border-0"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center bg-brand-light/50 relative">
                    <div className="w-16 h-16 rounded-full bg-black/50 border border-white/20 flex items-center justify-center backdrop-blur-md mb-4 text-white z-10">
                      <Play className="ml-1" size={24} />
                    </div>
                    <p className="text-gray-300 font-medium z-10">{vid.title}</p>
                    <div className="absolute inset-0 bg-gradient-to-tr from-brand-gold/20 to-transparent opacity-20" />
                  </div>
                )}
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 border-t border-white/10 text-center relative overflow-hidden">
        <div className="absolute inset-0 bg-brand-gold/5 pointer-events-none" />
        <h4 className="font-display font-bold text-2xl tracking-widest uppercase text-white mb-2">Casa Galería</h4>
        <p className="text-gray-500 text-sm">Residencial la Mesa del Malanquin</p>
      </footer>
    </div>
  );
}

export default App;
