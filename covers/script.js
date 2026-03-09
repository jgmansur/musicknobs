document.addEventListener('DOMContentLoaded', () => {
    // --- STATE VARIABLES ---
    let currentBgImage = null;
    let showParental = false;
    let showVinylRing = false;
    let startX, startY;

    // --- 1. PROMPT GENERATOR LOGIC ---
    const formOptions = {
        rutaDiseno: document.getElementById('ruta-diseno'),
        paletaCromatica: document.getElementById('paleta-cromatica'),
        conceptoVisual: document.getElementById('concepto-visual'),
        texturaAcabado: document.getElementById('textura-acabado')
    };
    const trackConceptInput = document.getElementById('track-concept');
    const titleInput = document.getElementById('cover-title'); // For canvas layer
    const generatedPromptEl = document.getElementById('generated-prompt');
    const copyBtn = document.getElementById('copy-prompt-btn');

    // Default positioning for 1000x1000
    const texts = {
        artist: { text: '', x: 50, y: 700, isDragging: false },
        title: { text: '', x: 50, y: 800, isDragging: false },
        label: { text: '', x: 950, y: 50, isDragging: false, align: 'right' }
    };

    function generatePrompt() {
        const palette = formOptions.paletaCromatica.value;
        const concept = formOptions.conceptoVisual.value;
        const texture = formOptions.texturaAcabado.value;
        const trackName = trackConceptInput.value.trim();

        // Sync the canvas title input with the concept input automatically
        titleInput.value = trackName;
        if (texts && texts.title) {
            texts.title.text = trackName;
            // only render if image is loaded (handled internally by renderCanvas)
            if (typeof renderCanvas === 'function') renderCanvas();
        }

        // Construct high-quality Midjourney/DALL-E prompt
        let prompt = `An iconic underground House Music album cover art, featuring ${concept}. `;

        if (trackName) {
            prompt += `The visual atmosphere and details should be thematically inspired by the concept and mood of the word(s) "${trackName}". `;
        }

        prompt += `Color palette strongly relying on ${palette}. `;
        prompt += `The image finish has ${texture}, creating a highly artistic and professional music design. `;
        prompt += `Minimalist, no text, typography-free art, masterpiece, photorealistic, 8k, --ar 1:1`;

        generatedPromptEl.value = prompt;
    }

    Object.values(formOptions).forEach(el => {
        if (el) el.addEventListener('change', generatePrompt);
    });
    // Re-generate prompt when the track title concept changes
    trackConceptInput.addEventListener('input', generatePrompt);

    generatePrompt();

    copyBtn.addEventListener('click', () => {
        generatedPromptEl.select();
        document.execCommand('copy');
        const originalText = copyBtn.innerHTML;
        copyBtn.innerHTML = '<i class="fa-solid fa-check"></i> ¡Copiado!';
        setTimeout(() => copyBtn.innerHTML = originalText, 2000);
    });

    // --- 2. CANVAS & TEXT EDITOR LOGIC ---
    const canvas = document.getElementById('cover-canvas');
    const ctx = canvas.getContext('2d');
    const imageUpload = document.getElementById('image-upload');
    const uploadArea = document.getElementById('upload-area');
    const textTools = document.getElementById('text-tools');
    const canvasWrapper = document.querySelector('.canvas-wrapper');
    const downloadBtn = document.getElementById('download-btn');

    // Inputs
    const artistInput = document.getElementById('cover-artist');
    const labelInput = document.getElementById('cover-label');

    const colorArtist = document.getElementById('color-artist');
    const colorTitle = document.getElementById('color-title');
    const colorLabel = document.getElementById('color-label');

    const sizeArtist = document.getElementById('size-artist');
    const sizeTitle = document.getElementById('size-title');
    const sizeLabel = document.getElementById('size-label');

    const fontSelect = document.getElementById('font-family');

    const toggleParentalBtn = document.getElementById('toggle-parental-btn');
    const toggleVinylBtn = document.getElementById('toggle-vinyl-btn');

    // Advanced Text Controls
    const alignLeftBtn = document.getElementById('align-left');
    const alignCenterBtn = document.getElementById('align-center');
    const alignRightBtn = document.getElementById('align-right');
    const letterSpacingSlider = document.getElementById('letter-spacing');
    const toggleShadow = document.getElementById('toggle-shadow');
    const toggleStroke = document.getElementById('toggle-stroke');

    let globalTextAlign = 'left';

    document.fonts.ready.then(() => renderCanvas());

    imageUpload.addEventListener('change', handleImageUpload);
    uploadArea.addEventListener('dragover', (e) => { e.preventDefault(); uploadArea.classList.add('dragover'); });
    uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('dragover'));
    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('dragover');
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            imageUpload.files = e.dataTransfer.files;
            handleImageUpload({ target: imageUpload });
        }
    });

    function handleImageUpload(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                currentBgImage = img;
                uploadArea.style.display = 'none';
                textTools.style.display = 'flex';
                canvasWrapper.style.display = 'block';
                downloadBtn.disabled = false;

                texts.artist.text = artistInput.value;
                texts.title.text = titleInput.value;
                texts.label.text = labelInput.value;

                renderCanvas();
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    }

    [artistInput, colorArtist, sizeArtist].forEach(el => el.addEventListener('input', () => { texts.artist.text = artistInput.value; renderCanvas(); }));
    [titleInput, colorTitle, sizeTitle].forEach(el => el.addEventListener('input', () => { texts.title.text = titleInput.value; renderCanvas(); }));
    [labelInput, colorLabel, sizeLabel].forEach(el => el.addEventListener('input', () => { texts.label.text = labelInput.value; renderCanvas(); }));
    fontSelect.addEventListener('change', renderCanvas);
    letterSpacingSlider.addEventListener('input', renderCanvas);
    toggleShadow.addEventListener('change', renderCanvas);
    toggleStroke.addEventListener('change', renderCanvas);

    [alignLeftBtn, alignCenterBtn, alignRightBtn].forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault(); // prevent form submit if inside form
            alignLeftBtn.classList.remove('active');
            alignCenterBtn.classList.remove('active');
            alignRightBtn.classList.remove('active');
            btn.classList.add('active');

            if (btn.id === 'align-left') globalTextAlign = 'left';
            if (btn.id === 'align-center') globalTextAlign = 'center';
            if (btn.id === 'align-right') globalTextAlign = 'right';

            renderCanvas();
        });
    });

    toggleParentalBtn.addEventListener('click', () => {
        showParental = !showParental;
        toggleParentalBtn.classList.toggle('active', showParental);
        renderCanvas();
    });

    toggleVinylBtn.addEventListener('click', () => {
        showVinylRing = !showVinylRing;
        toggleVinylBtn.classList.toggle('active', showVinylRing);
        renderCanvas();
    });

    function renderCanvas() {
        if (!currentBgImage) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // 1. Draw Image Object-Fit Cover
        const hRatio = canvas.width / currentBgImage.width;
        const vRatio = canvas.height / currentBgImage.height;
        const ratio = Math.max(hRatio, vRatio);
        const centerShiftX = (canvas.width - currentBgImage.width * ratio) / 2;
        const centerShiftY = (canvas.height - currentBgImage.height * ratio) / 2;

        ctx.drawImage(currentBgImage, 0, 0, currentBgImage.width, currentBgImage.height,
            centerShiftX, centerShiftY, currentBgImage.width * ratio, currentBgImage.height * ratio);

        // 2. Add Vinyl Ring effect
        if (showVinylRing) {
            drawVinylRing();
        }

        // 3. Draw Texts
        drawTextObj(texts.artist, sizeArtist.value, colorArtist.value, fontSelect.value, globalTextAlign);
        drawTextObj(texts.title, sizeTitle.value, colorTitle.value, fontSelect.value, globalTextAlign);
        drawTextObj(texts.label, sizeLabel.value, colorLabel.value, fontSelect.value, globalTextAlign);

        // 4. Draw Parental Advisory Badges
        if (showParental) {
            drawParentalBadge();
        }
    }

    function drawTextObj(item, size, color, fontName, align) {
        if (!item.text.trim()) return;

        ctx.font = `900 ${size}px "${fontName}"`;
        ctx.fillStyle = color;
        ctx.textAlign = align;
        ctx.textBaseline = "top";

        // Apply Tracking (Letter Spacing) if supported
        if ('letterSpacing' in ctx) {
            ctx.letterSpacing = `${letterSpacingSlider.value}px`;
        }

        // Apply Shadow conditionally
        if (toggleShadow.checked) {
            ctx.shadowColor = "rgba(0,0,0,0.8)";
            ctx.shadowBlur = 15;
            ctx.shadowOffsetX = 5;
            ctx.shadowOffsetY = 5;
        } else {
            ctx.shadowColor = "transparent";
            ctx.shadowBlur = 0;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;
        }

        ctx.fillText(item.text, item.x, item.y);

        // Apply Stroke (Outline) conditionally
        if (toggleStroke.checked) {
            ctx.save();
            ctx.shadowColor = "transparent"; // don't double shadow the stroke
            ctx.strokeStyle = "rgba(0,0,0,0.9)";
            ctx.lineWidth = Math.max(2, size * 0.05); // dynamic width based on font size
            // Re-apply letter spacing for stroke just in case
            if ('letterSpacing' in ctx) {
                ctx.letterSpacing = `${letterSpacingSlider.value}px`;
            }
            ctx.strokeText(item.text, item.x, item.y);
            ctx.restore();
        }

        // Reset so we don't bleed into other drawings
        ctx.shadowColor = "transparent";
        ctx.shadowBlur = 0;
        if ('letterSpacing' in ctx) {
            ctx.letterSpacing = "0px";
        }

        const metrics = ctx.measureText(item.text);
        item.width = metrics.width;

        // Calculate hitX based on alignment and the (potentially tracked) text width
        if (align === 'center') {
            item.hitX = item.x - (item.width / 2);
        } else if (align === 'right') {
            item.hitX = item.x - item.width;
        } else {
            item.hitX = item.x;
        }

        item.height = parseInt(size, 10);
    }

    function drawVinylRing() {
        ctx.beginPath();
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;
        const radius = (canvas.width / 2) - 30; // Closer to edge

        ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI, false);
        ctx.lineWidth = 15;
        // Subtle white fade overlay to simulate ring wear
        ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(centerX, centerY, radius - 20, 0, 2 * Math.PI, false);
        ctx.lineWidth = 5;
        ctx.strokeStyle = "rgba(0, 0, 0, 0.15)";
        ctx.stroke();
    }

    function drawParentalBadge() {
        const x = canvas.width - 250;
        const y = canvas.height - 150;
        const w = 200;
        const h = 100;

        ctx.fillStyle = 'white';
        ctx.fillRect(x, y, w, h);
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'black';
        ctx.strokeRect(x, y, w, h);

        ctx.fillStyle = 'black';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '900 24px "Arial"';
        ctx.fillText("PARENTAL", x + w / 2, y + 30);

        // Inner line
        ctx.beginPath();
        ctx.moveTo(x + 10, y + 50);
        ctx.lineTo(x + w - 10, y + 50);
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.font = '700 22px "Arial"';
        ctx.fillText("ADVISORY", x + w / 2, y + 65);
        ctx.font = '700 14px "Arial"';
        ctx.fillText("EXPLICIT CONTENT", x + w / 2, y + 85);
    }

    // --- CANVAS DRAG AND DROP ---
    function getMousePos(evt) {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        return {
            x: (evt.clientX - rect.left) * scaleX,
            y: (evt.clientY - rect.top) * scaleY // Fix for Y offset bug in original thumbnail app
        };
    }

    canvas.addEventListener('mousedown', (e) => {
        const pos = getMousePos(e);
        startX = pos.x;
        startY = pos.y;

        const textArray = [texts.artist, texts.title, texts.label];
        for (let i = textArray.length - 1; i >= 0; i--) {
            const item = textArray[i];
            if (!item.text) continue;

            const hx = item.hitX !== undefined ? item.hitX : item.x;
            if (pos.x >= hx && pos.x <= hx + item.width &&
                pos.y >= item.y && pos.y <= item.y + item.height) {
                item.isDragging = true;
                return;
            }
        }
    });

    canvas.addEventListener('mousemove', (e) => {
        const pos = getMousePos(e);
        let dragging = false;

        const textArray = [texts.artist, texts.title, texts.label];

        textArray.forEach(item => {
            if (item.isDragging) {
                dragging = true;
                const dx = pos.x - startX;
                const dy = pos.y - startY;
                item.x += dx;
                item.y += dy;
                if (item.hitX !== undefined) item.hitX += dx;
            }
        });

        if (dragging) {
            startX = pos.x;
            startY = pos.y;
            renderCanvas();
        } else {
            let hovering = false;
            for (let i = 0; i < textArray.length; i++) {
                const item = textArray[i];
                const hx = item.hitX !== undefined ? item.hitX : item.x;
                if (item.text && pos.x >= hx && pos.x <= hx + item.width &&
                    pos.y >= item.y && pos.y <= item.y + item.height) {
                    hovering = true;
                    break;
                }
            }
            canvas.style.cursor = hovering ? 'grab' : 'default';
        }
    });

    canvas.addEventListener('mouseup', () => {
        [texts.artist, texts.title, texts.label].forEach(t => t.isDragging = false);
        canvas.style.cursor = 'grab';
    });
    canvas.addEventListener('mouseout', () => {
        [texts.artist, texts.title, texts.label].forEach(t => t.isDragging = false);
        canvas.style.cursor = 'default';
    });

    // --- DOWNLOAD ---
    downloadBtn.addEventListener('click', () => {
        if (!currentBgImage) return;
        const dataURL = canvas.toDataURL('image/jpeg', 0.95);
        const link = document.createElement('a');
        link.download = 'Musicknobs_House_Cover.jpg';
        link.href = dataURL;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    });
});
