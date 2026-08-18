document.addEventListener('DOMContentLoaded', () => {
    // ── Elementos ──────────────────────────────────────────────
    const el = (id) => document.getElementById(id);

    const langEsBtn = el('lang-es');
    const langEnBtn = el('lang-en');
    const titleEl = el('page-title');
    const subtitleEl = el('page-subtitle');
    const dateDisplayEl = el('date-display');
    const newsContainerEl = el('news-container');
    const sourcesChip = el('sources-chip');
    const sourcesCount = el('sources-count');
    const staleWarning = el('stale-warning');
    const verifiedToggle = el('verified-toggle');
    const verifiedDetails = el('verified-details');
    const tipSection = el('tip-section');
    const archiveSection = el('archive-section');
    const archiveList = el('archive-list');

    // ── Textos de interfaz ─────────────────────────────────────
    const UI = {
        es: {
            liveUpdates: 'Actualización diaria',
            updatedText: 'Actualizado:',
            sources: (n) => `${n} ${n === 1 ? 'medio consultado' : 'medios consultados'}`,
            verifiedTitle: 'Noticias verificadas',
            verifiedSub: 'Cada nota proviene de un medio real y enlaza a su artículo original.',
            verifiedIntro: 'Así se arma esta página, todos los días y de forma automática:',
            verifiedStep1: 'Se leen los feeds de medios reales de la industria musical y legal, más búsquedas de prensa en español e inglés.',
            verifiedStep2: 'Se filtran solo las notas de copyright, IA y derechos musicales publicadas en los últimos días.',
            verifiedStep3: 'Se comprueba que la liga de cada artículo responda de verdad. La que no responde, se descarta.',
            verifiedStep4: 'La inteligencia artificial <strong>solo traduce y resume</strong> el texto del artículo original. No genera noticias ni agrega datos.',
            verifiedNote: 'Este resumen no es asesoría legal. Haz clic en cada tarjeta para leer la fuente completa y consulta a un abogado antes de tomar decisiones.',
            staleText: (d) => `La última actualización automática fue hace ${d} días. Las notas siguen siendo reales, pero puede haber novedades más recientes.`,
            readOriginal: 'Leer artículo original',
            via: 'vía',
            translated: 'Traducido automáticamente',
            tipLabel: 'Guía del día',
            archiveTitle: 'Ediciones anteriores',
            newsletterTitle: 'No te pierdas de nada',
            newsletterDesc: 'Únete a la lista para recibir alertas sobre cambios grandes de copyright para músicos y creadores que usan IA.',
            newsletterBtn: 'Suscribirse',
            newsletterDisclaimer: 'No enviamos spam. Date de baja cuando quieras.',
            emailPlaceholder: 'Tu correo electrónico',
            ytTitle: '¿Te sirvió esta información?',
            ytDesc: 'La mejor forma de agradecer y apoyar esta herramienta gratuita es suscribiéndote al canal de YouTube. ¡Aprende más sobre producción musical!',
            ytBtn: 'Suscribirme al canal',
            footerLegal: 'Los titulares y resúmenes pertenecen a sus medios originales, enlazados en cada tarjeta. Contenido informativo, no asesoría legal.',
            errorTitle: 'No pudimos cargar las noticias',
            errorSub: 'Vuelve a intentarlo en un momento.',
            tags: {
                lawsuit: 'Demandas', ai: 'IA', royalties: 'Regalías',
                licensing: 'Licencias', legislation: 'Legislación', streaming: 'Streaming'
            },
            relative: { today: 'Hoy', yesterday: 'Ayer', daysAgo: (n) => `Hace ${n} días` }
        },
        en: {
            liveUpdates: 'Daily update',
            updatedText: 'Updated:',
            sources: (n) => `${n} ${n === 1 ? 'outlet' : 'outlets'} checked`,
            verifiedTitle: 'Verified news',
            verifiedSub: 'Every story comes from a real outlet and links to its original article.',
            verifiedIntro: 'How this page is built, every day, automatically:',
            verifiedStep1: 'We read feeds from real music-industry and legal outlets, plus press searches in Spanish and English.',
            verifiedStep2: 'We keep only copyright, AI and music-rights stories published in the last few days.',
            verifiedStep3: 'We check that every article link actually resolves. Dead links are dropped.',
            verifiedStep4: 'AI <strong>only translates and summarizes</strong> the original article text. It never generates news or adds facts.',
            verifiedNote: 'This is not legal advice. Click any card to read the full source, and consult a lawyer before making decisions.',
            staleText: (d) => `The last automatic update ran ${d} days ago. The stories are still real, but newer developments may exist.`,
            readOriginal: 'Read original article',
            via: 'via',
            translated: 'Machine translated',
            tipLabel: 'Tip of the day',
            archiveTitle: 'Previous editions',
            newsletterTitle: "Don't miss a thing",
            newsletterDesc: 'Join the list for alerts on major copyright changes for musicians and AI creators.',
            newsletterBtn: 'Subscribe',
            newsletterDisclaimer: 'No spam. Unsubscribe any time.',
            emailPlaceholder: 'Your email address',
            ytTitle: 'Did you find this helpful?',
            ytDesc: 'The best way to say thanks and support this free tool is by subscribing to the YouTube channel. Learn more about music production!',
            ytBtn: 'Subscribe to the channel',
            footerLegal: 'Headlines and summaries belong to their original outlets, linked on each card. Informational content, not legal advice.',
            errorTitle: "We couldn't load the news",
            errorSub: 'Please try again in a moment.',
            tags: {
                lawsuit: 'Lawsuits', ai: 'AI', royalties: 'Royalties',
                licensing: 'Licensing', legislation: 'Legislation', streaming: 'Streaming'
            },
            relative: { today: 'Today', yesterday: 'Yesterday', daysAgo: (n) => `${n} days ago` }
        }
    };

    let newsData = null;
    let currentLang = localStorage.getItem('mk-noticias-lang') === 'en' ? 'en' : 'es';

    // ── Utilidades ─────────────────────────────────────────────
    const escapeHtml = (str = '') =>
        String(str).replace(/[&<>"']/g, (c) =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    function formatDate(dateString, lang) {
        const date = new Date(dateString);
        if (Number.isNaN(date.getTime())) return '—';
        return date.toLocaleDateString(lang === 'es' ? 'es-MX' : 'en-US', {
            year: 'numeric', month: 'long', day: 'numeric'
        });
    }

    function relativeDate(dateString, lang) {
        if (!dateString) return '';
        const date = new Date(dateString);
        if (Number.isNaN(date.getTime())) return '';
        const days = Math.floor((Date.now() - date.getTime()) / 86400000);
        const r = UI[lang].relative;
        if (days <= 0) return r.today;
        if (days === 1) return r.yesterday;
        if (days < 30) return r.daysAgo(days);
        return formatDate(dateString, lang);
    }

    function setText(id, value) {
        const node = el(id);
        if (node) node.textContent = value;
    }

    function setHtml(id, value) {
        const node = el(id);
        if (node) node.innerHTML = value;
    }

    // ── Carga de datos ─────────────────────────────────────────
    async function loadData() {
        try {
            const res = await fetch(`data.json?t=${Date.now()}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            newsData = await res.json();
            render();
        } catch (error) {
            console.error('Error cargando noticias:', error);
            const t = UI[currentLang];
            titleEl.textContent = t.errorTitle;
            subtitleEl.textContent = t.errorSub;
            newsContainerEl.innerHTML = '';
        }
        loadArchive();
    }

    async function loadArchive() {
        try {
            const res = await fetch(`archivo/index.json?t=${Date.now()}`);
            if (!res.ok) return;
            const index = await res.json();
            if (!Array.isArray(index) || index.length < 2) return;

            // La primera entrada es la edición de hoy, que ya se está viendo
            const previous = index.slice(1, 15);
            if (!previous.length) return;

            archiveList.innerHTML = previous
                .map((entry) => `
                    <a class="archive-chip" href="archivo/${encodeURIComponent(entry.date)}.json" target="_blank"
                       rel="noopener noreferrer">
                        <i class="fa-regular fa-calendar" aria-hidden="true"></i>
                        ${escapeHtml(entry.date)}
                        <span class="archive-count">${Number(entry.items) || 0}</span>
                    </a>`)
                .join('');
            archiveSection.hidden = false;
        } catch {
            /* el archivo es un extra: si falla, la página sigue igual de útil */
        }
    }

    // ── Render ─────────────────────────────────────────────────
    function renderStaticUI() {
        const t = UI[currentLang];

        setText('ui-live-updates', t.liveUpdates);
        setText('ui-updated-text', t.updatedText);
        setText('ui-verified-title', t.verifiedTitle);
        setText('ui-verified-sub', t.verifiedSub);
        setText('ui-verified-intro', t.verifiedIntro);
        setText('ui-verified-step1', t.verifiedStep1);
        setText('ui-verified-step2', t.verifiedStep2);
        setText('ui-verified-step3', t.verifiedStep3);
        setHtml('ui-verified-step4', t.verifiedStep4);
        setHtml('ui-verified-note',
            `<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> ${escapeHtml(t.verifiedNote)}`);
        setText('ui-tip-label', t.tipLabel);
        setText('ui-archive-title', t.archiveTitle);
        setText('ui-newsletter-title', t.newsletterTitle);
        setText('ui-newsletter-desc', t.newsletterDesc);
        setText('ui-newsletter-btn', t.newsletterBtn);
        setText('ui-newsletter-disclaimer', t.newsletterDisclaimer);
        setText('ui-yt-title', t.ytTitle);
        setText('ui-yt-desc', t.ytDesc);
        setText('ui-yt-btn', t.ytBtn);
        setText('ui-footer-legal', t.footerLegal);
        setText('footer-year', String(new Date().getFullYear()));

        const emailInput = el('email-input');
        if (emailInput) emailInput.placeholder = t.emailPlaceholder;

        document.documentElement.lang = currentLang;
    }

    function renderCards(items) {
        const t = UI[currentLang];

        newsContainerEl.innerHTML = items.map((item, index) => {
            const tags = (item.tags || [])
                .map((tag) => `<span class="tag tag-${escapeHtml(tag)}">${escapeHtml(t.tags[tag] || tag)}</span>`)
                .join('');

            const when = relativeDate(item.publishedAt, currentLang);
            const via = item.via ? ` <span class="card-via">${t.via} ${escapeHtml(item.via)}</span>` : '';
            const translated = item.translated
                ? `<span class="card-translated" title="${escapeHtml(t.translated)}">
                       <i class="fa-solid fa-language" aria-hidden="true"></i></span>`
                : '';

            return `
                <a class="news-card" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer"
                   style="animation-delay:${index * 0.06}s">
                    <div class="card-head">
                        <span class="card-source">
                            <i class="fa-regular fa-newspaper" aria-hidden="true"></i>
                            ${escapeHtml(item.source || item.domain || '')}${via}
                        </span>
                        ${when ? `<span class="card-date">${escapeHtml(when)}</span>` : ''}
                    </div>
                    <h3 class="card-title">${escapeHtml(item.title)}</h3>
                    ${item.summary ? `<p class="card-content">${escapeHtml(item.summary)}</p>` : '<div class="card-spacer"></div>'}
                    <div class="card-foot">
                        <div class="card-tags">${tags}${translated}</div>
                        <span class="card-link">
                            ${escapeHtml(t.readOriginal)}
                            <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i>
                        </span>
                    </div>
                </a>`;
        }).join('');
    }

    function renderTip(tip) {
        if (!tip || !tip.title) {
            tipSection.hidden = true;
            return;
        }
        setText('tip-title', tip.title);
        setText('tip-body-text', tip.body);
        tipSection.hidden = false;
    }

    function renderStaleWarning() {
        const updated = new Date(newsData.lastUpdated);
        const days = Math.floor((Date.now() - updated.getTime()) / 86400000);
        if (Number.isNaN(days) || days < 2) {
            staleWarning.hidden = true;
            return;
        }
        setText('ui-stale-text', UI[currentLang].staleText(days));
        staleWarning.hidden = false;
    }

    function render() {
        renderStaticUI();
        if (!newsData) return;

        const t = UI[currentLang];
        const langData = newsData[currentLang] || newsData.es;

        titleEl.textContent = langData.title;
        subtitleEl.textContent = langData.subtitle;
        dateDisplayEl.textContent = formatDate(newsData.lastUpdated, currentLang);

        const sources = newsData.meta && Array.isArray(newsData.meta.sources) ? newsData.meta.sources : [];
        if (sources.length) {
            sourcesCount.textContent = t.sources(sources.length);
            sourcesChip.hidden = false;
        }

        renderCards(langData.items || []);
        renderTip(langData.tip);
        renderStaleWarning();
    }

    // ── Interacción ────────────────────────────────────────────
    function switchLanguage(lang) {
        if (lang === currentLang) return;
        currentLang = lang;
        localStorage.setItem('mk-noticias-lang', lang);

        langEsBtn.classList.toggle('active', lang === 'es');
        langEnBtn.classList.toggle('active', lang === 'en');

        render();
    }

    langEsBtn.addEventListener('click', () => switchLanguage('es'));
    langEnBtn.addEventListener('click', () => switchLanguage('en'));

    verifiedToggle.addEventListener('click', () => {
        const open = verifiedDetails.hidden;
        verifiedDetails.hidden = !open;
        verifiedToggle.setAttribute('aria-expanded', String(open));
        verifiedToggle.classList.toggle('open', open);
    });

    // Estado inicial del toggle de idioma según lo guardado
    langEsBtn.classList.toggle('active', currentLang === 'es');
    langEnBtn.classList.toggle('active', currentLang === 'en');

    loadData();
});
