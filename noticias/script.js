document.addEventListener('DOMContentLoaded', () => {
    // Elements
    const langEsBtn = document.getElementById('lang-es');
    const langEnBtn = document.getElementById('lang-en');
    const titleEl = document.getElementById('page-title');
    const subtitleEl = document.getElementById('page-subtitle');
    const dateDisplayEl = document.getElementById('date-display');
    const newsContainerEl = document.getElementById('news-container');

    // UI Elements that need translation
    const uiLiveUpdates = document.getElementById('ui-live-updates');
    const uiUpdatedText = document.getElementById('ui-updated-text');
    const uiNewsletterTitle = document.getElementById('ui-newsletter-title');
    const uiNewsletterDesc = document.getElementById('ui-newsletter-desc');
    const uiNewsletterBtn = document.getElementById('ui-newsletter-btn');
    const uiNewsletterDisclaimer = document.getElementById('ui-newsletter-disclaimer');
    const emailInput = document.getElementById('email-input');
    const uiYtTitle = document.getElementById('ui-yt-title');
    const uiYtDesc = document.getElementById('ui-yt-desc');
    const uiYtBtn = document.getElementById('ui-yt-btn');

    // UI Translations
    const uiTranslations = {
        es: {
            liveUpdates: "Actualizaciones Diarias",
            updatedText: "Actualizado:",
            newsletterTitle: "No te pierdas de nada",
            newsletterDesc: "Únete a nuestra lista para recibir alertas exclusivas sobre grandes cambios en copyright para músicos y creadores usando IA.",
            newsletterBtn: "Suscribirse",
            newsletterDisclaimer: "No enviamos spam. Date de baja cuando quieras.",
            emailPlaceholder: "Tu correo electrónico",
            ytTitle: "¿Te sirvió esta información?",
            ytDesc: "La mejor forma de agradecer y apoyar la creación de esta herramienta gratuita es suscribiéndote al canal de YouTube. ¡Aprende más sobre producción musical!",
            ytBtn: "Suscribirme al Canal"
        },
        en: {
            liveUpdates: "Daily Updates",
            updatedText: "Updated:",
            newsletterTitle: "Don't miss a thing",
            newsletterDesc: "Join our mailing list to receive exclusive alerts on major copyright changes for musicians and AI creators.",
            newsletterBtn: "Subscribe",
            newsletterDisclaimer: "No spam. Unsubscribe at any time.",
            emailPlaceholder: "Your email address",
            ytTitle: "Did you find this helpful?",
            ytDesc: "The best way to say thanks and support this free tool is by subscribing to the YouTube channel. Learn more about music production!",
            ytBtn: "Subscribe to Channel"
        }
    };

    let newsData = null;
    let currentLang = 'es';

    // Fetch data
    async function fetchNewsData() {
        try {
            // Add a cache buster timestamp query parameter so we don't fetch old cached data
            const res = await fetch(`data.json?t=${new Date().getTime()}`);
            if (!res.ok) throw new Error('Failed to fetch data');
            newsData = await res.json();
            renderContent();
        } catch (error) {
            console.error('Error fetching news:', error);
            titleEl.textContent = "Error al cargar";
            subtitleEl.textContent = "Lo sentimos, no pudimos cargar las últimas noticias de copyright.";
            newsContainerEl.innerHTML = ''; // clear skeletons
        }
    }

    function formatDate(dateString, lang) {
        const date = new Date(dateString);
        return date.toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    }

    function renderContent() {
        if (!newsData) return;

        const langData = newsData[currentLang];
        const uiText = uiTranslations[currentLang];

        // Update fixed UI text
        uiLiveUpdates.textContent = uiText.liveUpdates;
        uiUpdatedText.textContent = uiText.updatedText;
        uiNewsletterTitle.textContent = uiText.newsletterTitle;
        uiNewsletterDesc.textContent = uiText.newsletterDesc;
        uiNewsletterBtn.textContent = uiText.newsletterBtn;
        uiNewsletterDisclaimer.textContent = uiText.newsletterDisclaimer;
        emailInput.placeholder = uiText.emailPlaceholder;

        if (uiYtTitle) uiYtTitle.textContent = uiText.ytTitle;
        if (uiYtDesc) uiYtDesc.textContent = uiText.ytDesc;
        if (uiYtBtn) uiYtBtn.textContent = uiText.ytBtn;

        // Update dynamic content
        titleEl.textContent = langData.title;
        subtitleEl.textContent = langData.subtitle;
        dateDisplayEl.textContent = formatDate(newsData.lastUpdated, currentLang);

        // Render articles
        newsContainerEl.innerHTML = '';
        langData.sections.forEach((section, index) => {
            const article = document.createElement('article');
            article.className = 'news-card';
            // Slight delay in animation based on index
            article.style.animationDelay = `${index * 0.1}s`;

            article.innerHTML = `
                <h3 class="card-title">${section.title}</h3>
                <div class="card-content">${section.content}</div>
            `;
            newsContainerEl.appendChild(article);
        });
    }

    function switchLanguage(lang) {
        if (lang === currentLang) return;
        currentLang = lang;

        // Update toggles
        if (lang === 'es') {
            langEsBtn.classList.add('active');
            langEnBtn.classList.remove('active');
        } else {
            langEnBtn.classList.add('active');
            langEsBtn.classList.remove('active');
        }

        renderContent();
    }

    // Event Listeners
    langEsBtn.addEventListener('click', () => switchLanguage('es'));
    langEnBtn.addEventListener('click', () => switchLanguage('en'));

    // Initialize
    fetchNewsData();
});
