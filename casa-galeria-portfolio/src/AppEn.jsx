import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MapPin, Maximize, TrendingUp, Instagram, Play, X, Droplets, Sun, Flame, ShieldCheck, Eye, TreePine, Map, Landmark, Star } from 'lucide-react';

const GalleryImages = [
  'IMG_2261.jpg', 'IMG_2269.jpg', 'IMG_2126.jpg', 'IMG_2124.jpg', 
  'IMG_2247.jpg', 'IMG_0006.JPG', 'IMG_0018.JPG', 'IMG_0012.JPG', 
  'IMG_0011.JPG', 'IMG_0016.JPG', 'IMG_0002.JPG', 'IMG_0005.JPG'
];

// Real YouTube IDs once the upload finishes
const VideoPlaceholders = [
  { title: "Exclusive Walkthrough", id: "LeSV9K8AsqY" },
  { title: "Interiors Reel", id: "q46Fmi6FORA" },
  { title: "Exteriors & Amenities Reel", id: "cq9A3kC_B_E" },
  { title: "Aerial View (Drone)", id: "uYOWJLKrzZ4" },
  { title: "Stories & Services", id: "hDyXAfxPB1w" }
];

const HeroImages = ["IMG_2261", "IMG_0016", "c628da91-9467-4885-b655-294b7ed88dfa", "a5d15570-cc2d-436f-b345-c1366ac80a6e"];
const PoolImages = ["IMG_1509", "IMG_1507"];
const MalanquinImages = ["malanquin-1.webp", "malanquin-2.png", "malanquin-3.jpg"];

export default function AppEn() {
  const [selectedImage, setSelectedImage] = useState(null);
  const [heroIndex, setHeroIndex] = useState(0);
  const [poolIndex, setPoolIndex] = useState(0);
  const [malanquinIndex, setMalanquinIndex] = useState(0);

  useEffect(() => {
    // Preload hero images
    HeroImages.forEach(img => {
      const image = new Image();
      image.src = `${import.meta.env.BASE_URL}assets/${img}.webp`;
    });
    
    // Preload pool images
    PoolImages.forEach(img => {
      const image = new Image();
      image.src = `${import.meta.env.BASE_URL}assets/${img}.JPG`;
    });

    // Preload malanquin images
    MalanquinImages.forEach(img => {
      const image = new Image();
      image.src = `${import.meta.env.BASE_URL}assets/${img}`;
    });

    // Hero Carousel Timer
    const timer = setInterval(() => {
      setHeroIndex(prev => (prev + 1) % HeroImages.length);
    }, 4500);

    // Pool Carousel Timer
    const poolTimer = setInterval(() => {
      setPoolIndex(prev => (prev + 1) % PoolImages.length);
    }, 8500);

    // Malanquin Carousel Timer
    const malanquinTimer = setInterval(() => {
      setMalanquinIndex(prev => (prev + 1) % MalanquinImages.length);
    }, 4500);

    return () => {
      clearInterval(timer);
      clearInterval(poolTimer);
      clearInterval(malanquinTimer);
    };
  }, []);
  return (
    <div className="min-h-screen bg-brand selection:bg-brand-gold/30">
      
      {/* Navbar */}
      <nav className="fixed top-0 w-full z-50 glass-panel py-4 px-6 flex justify-between items-center transition-all duration-300">
        <h1 className="font-display font-bold text-xl tracking-widest uppercase text-white">Casa Galeria</h1>
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
      <section className="relative min-h-[90vh] flex flex-col justify-center overflow-hidden">
        <div className="absolute inset-0 z-0 bg-black">
          <AnimatePresence mode="wait">
            <motion.img 
              key={heroIndex}
              initial={{ opacity: 0, scale: 1.05 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1.2, ease: "easeInOut" }}
              src={`${import.meta.env.BASE_URL}assets/${HeroImages[heroIndex]}.webp`} 
              alt="Casa Galeria Hero" 
              className="absolute inset-0 w-full h-full object-cover object-center"
            />
          </AnimatePresence>
          <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/40 to-brand z-10" />
        </div>
        
        <div className="relative z-20 text-center px-4 max-w-4xl mx-auto">
          <motion.h2 
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, delay: 0.2 }}
            className="font-display text-5xl md:text-7xl lg:text-8xl font-bold text-white mb-6 tracking-tight leading-tight"
          >
            Haven of <br/> <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand-gold to-yellow-200">Luxury and Design</span>
          </motion.h2>
          <motion.p 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1, delay: 0.8 }}
            className="text-lg md:text-xl text-gray-300 font-light max-w-2xl mx-auto"
          >
            An architectural jewel designed to inspire, rest, and enjoy the highest standard of living.
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
                Spaces designed in every detail.
              </h3>
              <p className="text-gray-400 text-lg leading-relaxed font-light">
                Located in one of the most exclusive areas, La Mesa del Malanquin Residential (13th Hole), this property offers a perfect balance between absolute privacy and avant-garde design.
              </p>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-6">
                <div className="glass-panel p-6 rounded-2xl flex flex-col gap-3">
                  <div className="w-12 h-12 rounded-full bg-brand-gold/10 flex items-center justify-center text-brand-gold">
                    <Maximize size={24} />
                  </div>
                  <div>
                    <p className="text-sm text-gray-400 font-medium uppercase tracking-wider">Lot Area</p>
                    <p className="text-2xl font-display font-semibold text-white">403.13 sq.m</p>
                  </div>
                </div>
                
                <div className="glass-panel p-6 rounded-2xl flex flex-col gap-3">
                  <div className="w-12 h-12 rounded-full bg-brand-gold/10 flex items-center justify-center text-brand-gold">
                    <MapPin size={24} />
                  </div>
                  <div>
                    <p className="text-sm text-gray-400 font-medium uppercase tracking-wider">Construction Area</p>
                    <p className="text-2xl font-display font-semibold text-white">360 sq.m approx.</p>
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
              <img src={`${import.meta.env.BASE_URL}assets/IMG_2269.webp`} alt="Interior Details" className="w-full h-full object-cover" />
              <div className="absolute inset-0 border border-white/10 rounded-3xl pointer-events-none" />
            </motion.div>
            
          </div>
        </div>
      </section>

      {/* Pool Section */}
      <section className="py-24 px-6 md:px-12 bg-black/30 relative">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8 }}
              className="relative aspect-square md:aspect-[4/3] rounded-3xl overflow-hidden shadow-2xl order-2 lg:order-1"
            >
              <AnimatePresence mode="wait">
                <motion.img 
                  key={poolIndex}
                  initial={{ opacity: 0, scale: 1.05 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 1.2, ease: "easeInOut" }}
                  src={`${import.meta.env.BASE_URL}assets/${PoolImages[poolIndex]}.JPG`} 
                  alt="Heated Pool" 
                  className="absolute inset-0 w-full h-full object-cover"
                />
              </AnimatePresence>
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent pointer-events-none" />
              <div className="absolute inset-0 border border-white/10 rounded-3xl pointer-events-none" />
            </motion.div>
            
            <motion.div 
              initial={{ opacity: 0, x: 50 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8 }}
              className="space-y-8 order-1 lg:order-2"
            >
              <h3 className="font-display text-4xl md:text-5xl font-semibold text-white leading-tight">
                Absolute relaxation. All year round.
              </h3>
              <p className="text-gray-400 text-lg leading-relaxed font-light">
                Spectacular pool equipped with the latest thermal technology to guarantee a perfect temperature regardless of the season.
              </p>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-6">
                <div className="glass-panel p-6 rounded-2xl flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-blue-500/10 flex flex-shrink-0 items-center justify-center text-blue-400">
                    <Droplets size={24} />
                  </div>
                  <div>
                    <h4 className="text-white font-medium">Luxury Pool</h4>
                    <p className="text-sm text-gray-400 mt-1">Edgeless design</p>
                  </div>
                </div>
                
                <div className="glass-panel p-6 rounded-2xl flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-brand-gold/10 flex flex-shrink-0 items-center justify-center text-brand-gold">
                    <Sun size={24} />
                  </div>
                  <div>
                    <h4 className="text-white font-medium">Eco-Thermal</h4>
                    <p className="text-sm text-gray-400 mt-1">10 Solar Panels</p>
                  </div>
                </div>

                <div className="glass-panel p-6 rounded-2xl flex items-center gap-4 sm:col-span-2">
                  <div className="w-12 h-12 rounded-full bg-orange-500/10 flex flex-shrink-0 items-center justify-center text-orange-400">
                    <Flame size={24} />
                  </div>
                  <div>
                    <h4 className="text-white font-medium">Hybrid Heating</h4>
                    <p className="text-sm text-gray-400 mt-1">Backed by a high-performance gas boiler for exceptionally cold days.</p>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Location, Views & Security */}
      <section className="py-24 px-6 md:px-12 relative border-y border-white/5">
        <div className="max-w-7xl mx-auto space-y-16">
          <div className="text-center max-w-3xl mx-auto">
            <h3 className="font-display text-4xl md:text-5xl font-bold text-white mb-6">Sought-After Location</h3>
            <p className="text-gray-400 text-lg font-light">Strategically connected yet shielded in absolute exclusivity and tranquility.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <motion.div initial={{opacity:0, y:20}} whileInView={{opacity:1, y:0}} viewport={{once:true}} className="glass-panel p-8 rounded-3xl group">
              <Map className="text-brand-gold mb-6 group-hover:scale-110 transition-transform" size={40} />
              <h4 className="text-2xl font-display font-semibold text-white mb-3">15 min to Downtown</h4>
              <p className="text-gray-400 font-light leading-relaxed">A short distance from the historic heart of San Miguel de Allende. Close enough to enjoy its magic, far enough to disconnect.</p>
            </motion.div>
            
            <motion.div initial={{opacity:0, y:20}} whileInView={{opacity:1, y:0}} viewport={{once:true}} transition={{delay:0.1}} className="glass-panel p-8 rounded-3xl group">
              <Eye className="text-brand-gold mb-6 group-hover:scale-110 transition-transform" size={40} />
              <h4 className="text-2xl font-display font-semibold text-white mb-3">Afternoons by the Glass</h4>
              <p className="text-gray-400 font-light leading-relaxed">Privileged orientation that frames unparalleled golden sunsets falling directly over the imposing Allende Reservoir.</p>
            </motion.div>

            <motion.div initial={{opacity:0, y:20}} whileInView={{opacity:1, y:0}} viewport={{once:true}} transition={{delay:0.2}} className="glass-panel p-8 rounded-3xl group">
              <ShieldCheck className="text-brand-gold mb-6 group-hover:scale-110 transition-transform" size={40} />
              <h4 className="text-2xl font-display font-semibold text-white mb-3">Security and Prestige</h4>
              <p className="text-gray-400 font-light leading-relaxed">The 13th Hole has over 80% of its lots already built, guaranteeing consolidated community tranquility. Highly restricted access with a 24/7 double security gate.</p>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Club de Golf Malanquin Section */}
      <section className="py-24 px-6 md:px-12 bg-zinc-950 relative overflow-hidden">
        <div className="absolute -top-[20%] -right-[10%] w-[50%] h-[50%] bg-brand-gold/5 blur-[120px] rounded-full pointer-events-none" />
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
                The Status of Malanquin Golf Club.
              </h3>
              <p className="text-gray-400 text-lg leading-relaxed font-light">
                Being part of this community gives you access to world-class amenities in one of the most exclusive trending clubs in Guanajuato, newly renovated to its maximum splendor.
              </p>
              
              <ul className="space-y-4 pt-4">
                {[
                  "Challenging 18-hole Golf Course",
                  "Brand-new Clubhouse and Restaurant",
                  "Professional-grade Tennis and Padel Courts",
                  "Semi-Olympic Pool, Gym, and Spa",
                  "Family Room and extensive landscape architecture"
                ].map((item, index) => (
                  <motion.li 
                    key={index}
                    initial={{ opacity: 0, x: -20 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: index * 0.1 }}
                    className="flex items-center gap-4 text-gray-300"
                  >
                    <div className="w-8 h-8 rounded-full bg-brand-gold/10 flex items-center justify-center text-brand-gold flex-shrink-0">
                      <TreePine size={16} />
                    </div>
                    <span className="font-medium">{item}</span>
                  </motion.li>
                ))}
              </ul>
            </motion.div>

            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8 }}
              className="relative aspect-[4/3] rounded-3xl overflow-hidden shadow-2xl"
            >
              <AnimatePresence mode="wait">
                <motion.img 
                  key={malanquinIndex}
                  initial={{ opacity: 0, scale: 1.05 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 1.2, ease: "easeInOut" }}
                  src={`${import.meta.env.BASE_URL}assets/${MalanquinImages[malanquinIndex]}`} 
                  alt="Club Malanquin" 
                  className="absolute inset-0 w-full h-full object-cover"
                />
              </AnimatePresence>
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
              <div className="absolute bottom-6 left-6 right-6">
                <p className="text-brand-gold font-display tracking-widest uppercase text-sm mb-1">Premium Amenities</p>
                <p className="text-white font-medium text-lg">An unrivaled lifestyle in San Miguel.</p>
              </div>
              <div className="absolute inset-0 border border-white/10 rounded-3xl pointer-events-none" />
            </motion.div>
            
          </div>
        </div>
      </section>

      {/* Plusvalia */}
      <section className="py-24 px-6 md:px-12 relative border-t border-brand-gold/20 bg-gradient-to-b from-brand-gold/5 to-transparent">
        <div className="max-w-5xl mx-auto text-center space-y-12">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-brand-gold/20 text-brand-gold mb-4"
          >
            <Landmark size={16} />
            <span className="text-sm font-semibold tracking-wide uppercase">Rapidly Rising Market</span>
          </motion.div>
          
          <h3 className="font-display text-4xl md:text-5xl font-bold text-white mb-6">
            Guaranteed Real Estate Appreciation
          </h3>
          <p className="text-gray-300 text-xl leading-relaxed font-light mx-auto max-w-4xl">
            The Malanquin area has established itself as the epicenter of closed-door luxury in San Miguel de Allende. Properties here enjoy relentless historical appreciation, driven by the scarcity of premium land and an elite community infrastructure.
          </p>
          <p className="text-gray-400 text-lg leading-relaxed font-light mx-auto max-w-3xl">
            Acquiring property in this cluster not only ensures a first-world lifestyle but also serves as a powerful financial shield against inflation, asymmetrically anchored to one of the most coveted cultural destinations worldwide.
          </p>
        </div>
      </section>

      {/* Investment Section */}
      <section className="py-24 px-6 md:px-12 bg-black/50 relative border-y border-white/5">
        <div className="max-w-4xl mx-auto text-center space-y-12">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="inline-flex items-center gap-2 px-6 py-2 rounded-full bg-[#FF5A5F]/10 border border-[#FF5A5F]/20 text-[#FF5A5F] mb-4"
          >
            <Star size={16} className="fill-current" />
            <span className="text-sm font-bold tracking-wide uppercase">Airbnb Superhost</span>
          </motion.div>
          
          <h3 className="font-display text-3xl md:text-5xl font-bold text-white mb-6">
            Proven ROI History
          </h3>
          <p className="text-gray-400 text-lg max-w-2xl mx-auto font-light">
            Previously operated successfully on short-term rental platforms, generating exceptional metrics that validate its value as a premium real estate asset.
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
              <h3 className="font-display text-4xl md:text-5xl font-bold text-white mb-4">Gallery</h3>
              <p className="text-gray-400 font-light">Explore every corner of this masterpiece.</p>
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
                className="group relative rounded-2xl overflow-hidden bg-brand-light break-inside-avoid cursor-zoom-in"
                onClick={() => setSelectedImage(img)}
              >
                <img 
                  src={`${import.meta.env.BASE_URL}assets/${img.replace(/\.[^/.]+$/, "")}.webp`} 
                  alt={`Casa Galeria ${i}`}
                  loading="lazy"
                  className="w-full h-auto object-cover transform transition-transform duration-700 group-hover:scale-105"
                />
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Video Walkthroughs */}
      <section className="py-24 px-4 md:px-8 bg-black/30">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16 space-y-4">
            <h3 className="font-display text-4xl md:text-5xl font-bold text-white">Visual Walkthroughs</h3>
            <p className="text-gray-400 font-light max-w-2xl mx-auto">Experience the atmosphere and details through our cinematic videos.</p>
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

          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="flex justify-center mt-12 pt-8"
          >
            <a 
              href="https://www.instagram.com/casagaleriasanmiguel" 
              target="_blank" 
              rel="noopener noreferrer"
              className="group inline-flex items-center gap-4 px-8 py-4 rounded-full bg-zinc-900 border border-white/10 hover:border-pink-500/50 hover:bg-zinc-800 transition-all duration-300 shadow-2xl hover:shadow-[0_0_60px_-15px_rgba(236,72,153,0.3)]"
            >
              <div className="bg-gradient-to-tr from-yellow-400 via-pink-500 to-purple-500 p-2.5 rounded-full shadow-lg">
                <Instagram className="text-white" size={24} strokeWidth={2.5} />
              </div>
              <span className="font-light tracking-wide text-lg text-gray-200">Visit our Instagram to see more visual walkthroughs</span>
            </a>
          </motion.div>

        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 border-t border-white/10 text-center relative overflow-hidden">
        <div className="absolute inset-0 bg-brand-gold/5 pointer-events-none" />
        <h4 className="font-display font-bold text-2xl tracking-widest uppercase text-white mb-2">Casa Galeria</h4>
        <p className="text-gray-500 text-sm">La Mesa del Malanquin Residential</p>
      </footer>
    </div>
  );
}
