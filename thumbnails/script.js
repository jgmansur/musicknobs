document.addEventListener('DOMContentLoaded', () => {
    // --- 0. COMMON DOM ELEMENTS (Define first to avoid ReferenceError) ---
    const canvas = document.getElementById('thumbnail-canvas');
    const ctx = canvas.getContext('2d');
    const imageUpload = document.getElementById('image-upload');
    const uploadArea = document.getElementById('upload-area');
    const textTools = document.getElementById('text-tools');
    const canvasWrapper = document.querySelector('.canvas-wrapper');
    const downloadBtn = document.getElementById('download-btn');

    // Inputs
    const text0Input = document.getElementById('thumb-text-0');
    const text1Input = document.getElementById('thumb-text-1');
    const text2Input = document.getElementById('thumb-text-2');
    const color0Input = document.getElementById('color-0');
    const color1Input = document.getElementById('color-1');
    const color2Input = document.getElementById('color-2');
    const size0Input = document.getElementById('size-0');
    const size1Input = document.getElementById('size-1');
    const size2Input = document.getElementById('size-2');
    const rotate0Input = document.getElementById('rotate-0');
    const rotate1Input = document.getElementById('rotate-1');
    const rotate2Input = document.getElementById('rotate-2');
    
    const font0Select = document.getElementById('font-0');
    const font1Select = document.getElementById('font-1');
    const font2Select = document.getElementById('font-2');
    const addVsBtn = document.getElementById('add-vs-btn');

    // Advanced Config
    const letterSpacingInput = document.getElementById('letter-spacing');
    const toggleShadowInput = document.getElementById('toggle-shadow');
    const toggleStrokeInput = document.getElementById('toggle-stroke');
    const bgYOffsetInput = document.getElementById('bg-y-offset');
    const vignetteIntensityInput = document.getElementById('vignette-intensity');
    const vignetteSideInput = document.getElementById('vignette-side');
    const bgBlurInput = document.getElementById('bg-blur');

    // Text objects to handle dragging
    const texts = [
        { id: 0, text: '', x: 100, y: 150, color: '#FFFFFF', rotation: 0, isDragging: false },
        { id: 1, text: '', x: 100, y: 300, color: '#FFFFFF', rotation: 0, isDragging: false },
        { id: 2, text: '', x: 100, y: 450, color: '#FF3366', rotation: 0, isDragging: false }
    ];

    let currentBgImage = null;
    let showVsBadge = false;
    let startX, startY;

    // Logos
    const logoUpload = document.getElementById('logo-upload');
    const addLogoBtn = document.getElementById('add-logo-btn');
    const logosListEl = document.getElementById('logos-list');
    const logos = []; // {id, img, x, y, scale, rotation, baseW, baseH, isDragging, rowEl}
    let logoSeq = 0;
    let selectedLogoId = null;

    // Frame
    const toggleFrameInput = document.getElementById('toggle-frame');
    const frameColorInput = document.getElementById('frame-color');
    const frameThicknessInput = document.getElementById('frame-thickness');
    const frameCornerInput = document.getElementById('frame-corner');
    const logoLayerInput = document.getElementById('logo-layer');
    [toggleFrameInput, frameColorInput, frameThicknessInput, frameCornerInput, logoLayerInput].forEach(el => {
        el.addEventListener('input', renderCanvas);
        el.addEventListener('change', renderCanvas);
    });
    // Double click resets frame thickness
    frameThicknessInput.addEventListener('dblclick', (e) => {
        e.preventDefault();
        frameThicknessInput.value = 35;
        renderCanvas();
    });

    // --- 1. PROMPT GENERATOR LOGIC ---
    const formOptions = {
        concept: document.getElementById('video-concept'),
        arquetipo: document.getElementById('arquetipo'),
        sujeto: document.getElementById('sujeto'),
        entorno: document.getElementById('entorno'),
        iluminacion: document.getElementById('iluminacion')
    };
    const generatedPromptEl = document.getElementById('generated-prompt');
    const copyBtn = document.getElementById('copy-prompt-btn');

    function generatePrompt() {
        const concept = formOptions.concept.value || "a professional music topic";
        const arquetipo = formOptions.arquetipo.value;
        const sujetoExp = formOptions.sujeto.value;
        let entorno = formOptions.entorno.value;
        
        if (entorno === 'custom') {
            entorno = document.getElementById('entorno-custom').value || 'dark high-end recording studio';
        } else if (!entorno) {
            entorno = 'dark high-end recording studio';
        }
        const luces = formOptions.iluminacion.value;

        // Sync Concept with Canvas Texts
        syncConceptToText(concept);

        let basePrompt = `Based on the reference image in my google drive 'Jay Looks 1.jpg', generate a highly realistic professional music producer`;

        if (sujetoExp === 'no subject') {
            basePrompt = `Generate a highly realistic scene about "${concept}"`;
        } else {
            basePrompt += ` with a ${sujetoExp}, focused on "${concept}",`;
        }

        let framing = "subject on the right, empty space on the left for text placement";
        if (arquetipo === 'comparativa') {
            framing = "split composition, subject on the right, complementary opposing colors on the left side";
        } else if (arquetipo === 'tutorial') {
            framing = "Shallow Depth of Field (f/1.8 lens), focused heavily on the foreground, background blurred, subject on the right";
        }

        const fullPrompt = `${basePrompt} in a ${entorno}, Cinematic Lighting, ${luces}, professional studio photography, ${framing}, 8k resolution, photorealistic, --ar 16:9`;

        generatedPromptEl.value = fullPrompt;
    }

    function syncConceptToText(text) {
        if (!text) return;
        
        const words = text.toUpperCase().split(' ');
        
        // Logical splitting for 3 lines - Optimized for common word counts
        if (words.length >= 3) {
            let part0, part1, part2;
            
            if (words.length === 3) {
                part0 = words[0];
                part1 = words[1];
                part2 = words[2];
            } else if (words.length === 4) {
                // Better distribution for 4 words: 2-1-1 (Classic Impact style)
                part0 = words.slice(0, 2).join(' ');
                part1 = words[2];
                part2 = words[3];
            } else {
                // Dynamic distribution for 5+ words
                const partSize = Math.ceil(words.length / 3);
                part0 = words.slice(0, partSize).join(' ');
                part1 = words.slice(partSize, partSize * 2).join(' ');
                part2 = words.slice(partSize * 2).join(' ');
            }
            
            if (!text0Input.value || text0Input.value === "DESCUBRE EL") {
                text0Input.value = part0;
                texts[0].text = part0;
            }
            if (!text1Input.value || text1Input.value === "NUEVO SECRETO") {
                text1Input.value = part1;
                texts[1].text = part1;
            }
            if (!text2Input.value || text2Input.value === "DE MEZCLA") {
                text2Input.value = part2;
                texts[2].text = part2;
            }
        } else if (words.length === 2) {
            if (!text1Input.value || text1Input.value === "NUEVO SECRETO") {
                text1Input.value = words[0];
                texts[1].text = words[0];
            }
            if (!text2Input.value || text2Input.value === "DE MEZCLA") {
                text2Input.value = words[1];
                texts[2].text = words[1];
            }
        } else {
            if (!text1Input.value || text1Input.value === "NUEVO SECRETO") {
                text1Input.value = text.toUpperCase();
                texts[1].text = text.toUpperCase();
            }
        }
        renderCanvas();
    }

    // Attach listeners to update prompt instantly
    Object.values(formOptions).forEach(el => {
        if (el) el.addEventListener('input', generatePrompt);
    });

    // Custom Entorno UI Toggle
    formOptions.entorno.addEventListener('change', (e) => {
        document.getElementById('entorno-custom').style.display = e.target.value === 'custom' ? 'block' : 'none';
        generatePrompt();
    });
    document.getElementById('entorno-custom').addEventListener('input', generatePrompt);

    // Initial generation
    generatePrompt();

    copyBtn.addEventListener('click', () => {
        generatedPromptEl.select();
        document.execCommand('copy');
        const originalText = copyBtn.innerHTML;
        copyBtn.innerHTML = '<i class="fa-solid fa-check"></i> ¡Copiado!';
        setTimeout(() => copyBtn.innerHTML = originalText, 2000);
    });

    // --- 2. CANVAS & TEXT EDITOR LOGIC ---
    // Load custom fonts to ensure they render on canvas immediately
    document.fonts.ready.then(() => {
        renderCanvas();
    });

    // Handle Image Upload (file picker — first load)
    imageUpload.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) loadBgImageFromFile(file);
    });

    // Drag & Drop for upload area (first load)
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('dragover');
    });
    uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('dragover'));
    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('dragover');
        const file = e.dataTransfer.files && e.dataTransfer.files[0];
        if (file) loadBgImageFromFile(file);
    });

    // Drag & Drop on canvas — REPLACE bg image without touching texts/logos
    canvasWrapper.addEventListener('dragover', (e) => {
        if (!currentBgImage) return;
        e.preventDefault();
        canvasWrapper.classList.add('dragover-replace');
    });
    canvasWrapper.addEventListener('dragleave', () => {
        canvasWrapper.classList.remove('dragover-replace');
    });
    canvasWrapper.addEventListener('drop', (e) => {
        if (!currentBgImage) return;
        e.preventDefault();
        canvasWrapper.classList.remove('dragover-replace');
        const file = e.dataTransfer.files && e.dataTransfer.files[0];
        if (file) loadBgImageFromFile(file, { replaceOnly: true });
    });

    function loadBgImageFromFile(file, { replaceOnly = false } = {}) {
        if (!file || !file.type.startsWith('image/')) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                currentBgImage = img;

                if (!replaceOnly) {
                    uploadArea.style.display = 'none';
                    textTools.style.display = 'flex';
                    canvasWrapper.style.display = 'block';
                    downloadBtn.disabled = false;

                    // Set default texts if empty
                    if (!text0Input.value) text0Input.value = "DESCUBRE EL";
                    if (!text1Input.value) text1Input.value = "NUEVO SECRETO";
                    if (!text2Input.value) text2Input.value = "DE MEZCLA";
                    texts[0].text = text0Input.value;
                    texts[1].text = text1Input.value;
                    texts[2].text = text2Input.value;
                }

                renderCanvas();
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    }

    // --- 3. SLIDER POLISH HELPER (Snapping & Reset) ---
    function applySliderPolish(input, defaultValue, snapRange = 10) {
        if (!input) return;

        // Snapping logic
        input.addEventListener('input', (e) => {
            const val = parseInt(e.target.value);
            if (Math.abs(val - defaultValue) < snapRange && val !== defaultValue) {
                e.target.value = defaultValue;
            }
            renderCanvas();
        });

        // Reset shortcut: Cmd/Ctrl + Click
        input.addEventListener('mousedown', (e) => {
            if (e.metaKey || e.ctrlKey) {
                e.preventDefault();
                input.value = defaultValue;
                renderCanvas();
            }
        });

        // Reset shortcut: double click
        input.addEventListener('dblclick', (e) => {
            e.preventDefault();
            input.value = defaultValue;
            renderCanvas();
        });
    }

    // Connect text inputs to canvas rendering
    text0Input.addEventListener('input', (e) => { texts[0].text = e.target.value; renderCanvas(); });
    text1Input.addEventListener('input', (e) => { texts[1].text = e.target.value; renderCanvas(); });
    text2Input.addEventListener('input', (e) => { texts[2].text = e.target.value; renderCanvas(); });
    
    color0Input.addEventListener('input', (e) => { texts[0].color = e.target.value; renderCanvas(); });
    color1Input.addEventListener('input', (e) => { texts[1].color = e.target.value; renderCanvas(); });
    color2Input.addEventListener('input', (e) => { texts[2].color = e.target.value; renderCanvas(); });
    
    rotate2Input.addEventListener('input', (e) => { texts[2].rotation = parseInt(e.target.value); renderCanvas(); });

    toggleShadowInput.addEventListener('change', renderCanvas);
    toggleStrokeInput.addEventListener('change', renderCanvas);
    
    // Apply Global Slider Polish
    applySliderPolish(bgYOffsetInput, 0, 10);
    applySliderPolish(vignetteIntensityInput, 80, 5);
    vignetteSideInput.addEventListener('change', renderCanvas);
    applySliderPolish(bgBlurInput, 0, 2);
    applySliderPolish(letterSpacingInput, 0, 2); // Reduced range for fine movement
    applySliderPolish(rotate0Input, 0, 5);      // Balanced range for rotation
    applySliderPolish(rotate1Input, 0, 5);
    applySliderPolish(rotate2Input, 0, 5);
    applySliderPolish(size0Input, 100, 10);
    applySliderPolish(size1Input, 130, 10);
    applySliderPolish(size2Input, 130, 10);

    async function loadFontAndRender(fontName) {
        try {
            await document.fonts.load(`900 80px "${fontName}"`);
        } catch (_) {
            // If loading fails, still force render with fallback
        }
        renderCanvas();
    }

    [font0Select, font1Select, font2Select].forEach(selectEl => {
        selectEl.addEventListener('change', (e) => {
            loadFontAndRender(e.target.value);
        });
    });

    addVsBtn.addEventListener('click', () => {
        showVsBadge = !showVsBadge;
        addVsBtn.textContent = showVsBadge ? 'Quitar "VS"' : 'Añadir "VS"';
        addVsBtn.style.background = showVsBadge ? '#5e6ad2' : 'var(--danger)';
        renderCanvas();
    });

    // --- LOGOS --- (label[for=logo-upload] triggers the input natively)
    logoUpload.addEventListener('change', (e) => {
        const files = Array.from(e.target.files || []);
        files.forEach(addLogoFromFile);
        logoUpload.value = '';
    });

    function addLogoFromFile(file) {
        const reader = new FileReader();
        reader.onload = (ev) => {
            const img = new Image();
            img.onload = () => {
                const id = ++logoSeq;
                // Initial scale: fit ~25% of canvas width
                const targetW = canvas.width * 0.25;
                const scale = Math.min(1, targetW / img.width);
                const logo = {
                    id,
                    img,
                    x: canvas.width / 2 - (img.width * scale) / 2,
                    y: canvas.height / 2 - (img.height * scale) / 2,
                    scale,
                    rotation: 0,
                    baseW: img.width,
                    baseH: img.height,
                    isDragging: false,
                    name: file.name
                };
                logos.push(logo);
                addLogoRow(logo);
                selectedLogoId = id;
                renderCanvas();
            };
            img.src = ev.target.result;
        };
        reader.readAsDataURL(file);
    }

    function addLogoRow(logo) {
        const row = document.createElement('div');
        row.className = 'logo-row';
        row.dataset.id = logo.id;
        row.innerHTML = `
            <img class="logo-thumb" src="${logo.img.src}" alt="${logo.name}">
            <div class="logo-controls">
                <div class="logo-slider-row" title="Tamaño">
                    <i class="fa-solid fa-up-right-and-down-left-from-center"></i>
                    <input type="range" class="logo-scale" min="5" max="300" value="${Math.round(logo.scale * 100)}">
                </div>
                <div class="logo-slider-row" title="Rotación">
                    <i class="fa-solid fa-rotate"></i>
                    <input type="range" class="logo-rotate" min="-180" max="180" value="0">
                </div>
            </div>
            <button type="button" class="logo-delete" title="Eliminar"><i class="fa-solid fa-trash"></i></button>
        `;

        const scaleInput = row.querySelector('.logo-scale');
        const rotateInput = row.querySelector('.logo-rotate');
        const deleteBtn = row.querySelector('.logo-delete');
        const thumb = row.querySelector('.logo-thumb');

        const defaultScalePct = parseInt(scaleInput.value);
        scaleInput.addEventListener('input', (e) => {
            logo.scale = parseInt(e.target.value) / 100;
            renderCanvas();
        });
        scaleInput.addEventListener('dblclick', (e) => {
            e.preventDefault();
            scaleInput.value = defaultScalePct;
            logo.scale = defaultScalePct / 100;
            renderCanvas();
        });
        rotateInput.addEventListener('input', (e) => {
            logo.rotation = parseInt(e.target.value);
            renderCanvas();
        });
        rotateInput.addEventListener('dblclick', (e) => {
            e.preventDefault();
            rotateInput.value = 0;
            logo.rotation = 0;
            renderCanvas();
        });
        deleteBtn.addEventListener('click', () => {
            const idx = logos.findIndex(l => l.id === logo.id);
            if (idx >= 0) logos.splice(idx, 1);
            row.remove();
            if (selectedLogoId === logo.id) selectedLogoId = null;
            renderCanvas();
        });
        thumb.addEventListener('click', () => {
            // Bring to front
            const idx = logos.findIndex(l => l.id === logo.id);
            if (idx >= 0) {
                const [item] = logos.splice(idx, 1);
                logos.push(item);
            }
            selectedLogoId = logo.id;
            updateLogoSelection();
            renderCanvas();
        });

        logo.rowEl = row;
        logosListEl.appendChild(row);
        updateLogoSelection();
    }

    function updateLogoSelection() {
        document.querySelectorAll('.logo-row').forEach(r => {
            r.classList.toggle('selected', parseInt(r.dataset.id) === selectedLogoId);
        });
    }

    function drawLogos() {
        logos.forEach(logo => {
            const w = logo.baseW * logo.scale;
            const h = logo.baseH * logo.scale;
            const cx = logo.x + w / 2;
            const cy = logo.y + h / 2;
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(logo.rotation * Math.PI / 180);
            ctx.drawImage(logo.img, -w / 2, -h / 2, w, h);
            ctx.restore();
        });
    }

    // Hit-test logo respecting rotation (transform mouse into logo local space)
    function hitTestLogo(logo, px, py) {
        const w = logo.baseW * logo.scale;
        const h = logo.baseH * logo.scale;
        const cx = logo.x + w / 2;
        const cy = logo.y + h / 2;
        const cos = Math.cos(-logo.rotation * Math.PI / 180);
        const sin = Math.sin(-logo.rotation * Math.PI / 180);
        const dx = px - cx;
        const dy = py - cy;
        const lx = dx * cos - dy * sin;
        const ly = dx * sin + dy * cos;
        return lx >= -w / 2 && lx <= w / 2 && ly >= -h / 2 && ly <= h / 2;
    }

    function renderCanvas() {
        if (!currentBgImage) return;

        // Clear canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // 1. Draw Background Image
        const hRatio = canvas.width / currentBgImage.width;
        const vRatio = canvas.height / currentBgImage.height;
        const ratio = Math.max(hRatio, vRatio);
        const centerShiftX = (canvas.width - currentBgImage.width * ratio) / 2;
        
        // Use the slider value directly for the vertical offset
        const yOffset = parseInt(bgYOffsetInput.value) || 0;
        const centerShiftY = ((canvas.height - currentBgImage.height * ratio) / 2) + yOffset;

        // Apply blur ONLY to the background image (reset after)
        const blurPx = parseInt(bgBlurInput.value) || 0;
        if (blurPx > 0) ctx.filter = `blur(${blurPx}px)`;
        ctx.drawImage(currentBgImage, 0, 0, currentBgImage.width, currentBgImage.height,
            centerShiftX, centerShiftY, currentBgImage.width * ratio, currentBgImage.height * ratio);
        ctx.filter = 'none';

        // 2. Add Vignette (intensidad y lado controlados por UI)
        const vignetteAlpha = (parseInt(vignetteIntensityInput.value) || 0) / 100;
        if (vignetteAlpha > 0) {
            const side = vignetteSideInput.value;
            const startX = side === 'right' ? canvas.width : 0;
            const endX = side === 'right' ? canvas.width * 0.4 : canvas.width * 0.6;
            const gradient = ctx.createLinearGradient(startX, 0, endX, 0);
            gradient.addColorStop(0, `rgba(0,0,0,${vignetteAlpha})`);
            gradient.addColorStop(1, "rgba(0,0,0,0)");
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }

        // 3. Draw Logos below text (optional)
        if (logoLayerInput.value === 'below') {
            drawLogos();
        }

        // 4. Draw Texts
        texts.forEach((item, index) => {
            if (!item.text.trim()) return;

            const fontName = index === 0
                ? font0Select.value
                : index === 1
                    ? font1Select.value
                    : font2Select.value;
            let fontSize;
            if (index === 0) fontSize = size0Input.value;
            else if (index === 1) fontSize = size1Input.value;
            else fontSize = size2Input.value;

            ctx.save();
            ctx.translate(item.x, item.y);
            
            let rotation;
            if (index === 0) rotation = parseInt(rotate0Input.value) || 0;
            else if (index === 1) rotation = parseInt(rotate1Input.value) || 0;
            else rotation = parseInt(rotate2Input.value) || 0;
            
            ctx.rotate(rotation * Math.PI / 180);

            ctx.font = `900 ${fontSize}px "${fontName}"`;
            ctx.fillStyle = item.color;
            ctx.textAlign = "left";
            ctx.textBaseline = "top";
            ctx.letterSpacing = letterSpacingInput.value + "px";
            ctx.lineJoin = "round";

            if (toggleShadowInput.checked) {
                ctx.shadowColor = "rgba(0,0,0,0.9)";
                ctx.shadowBlur = 15;
                ctx.shadowOffsetX = 8;
                ctx.shadowOffsetY = 8;
            }

            if (toggleStrokeInput.checked) {
                ctx.lineWidth = 10;
                ctx.strokeStyle = '#000000';
                ctx.strokeText(item.text.toUpperCase(), 0, 0);
                ctx.shadowColor = "transparent";
                ctx.fillText(item.text.toUpperCase(), 0, 0);
            } else {
                ctx.fillText(item.text.toUpperCase(), 0, 0);
            }

            const metrics = ctx.measureText(item.text.toUpperCase());
            item.width = metrics.width;
            item.height = parseInt(fontSize, 10);

            ctx.restore();
        });

        // 5. Draw Logos on top of text (optional)
        if (logoLayerInput.value !== 'below') {
            drawLogos();
        }

        if (showVsBadge) drawVSBadge();

        // 6. Draw Frame LAST so it always sits on top
        drawFrame();
    }

    function drawFrame() {
        if (!toggleFrameInput.checked) return;
        const t = parseInt(frameThicknessInput.value) || 0;
        const corner = Math.max(0, parseInt(frameCornerInput.value) || 0);
        if (t <= 0) return;
        const frameLayer = document.createElement('canvas');
        frameLayer.width = canvas.width;
        frameLayer.height = canvas.height;
        const fctx = frameLayer.getContext('2d');

        // 1) Paint solid frame layer
        fctx.fillStyle = frameColorInput.value;
        fctx.fillRect(0, 0, frameLayer.width, frameLayer.height);

        // 2) Punch transparent hole in the center (optionally rounded)
        const innerX = t;
        const innerY = t;
        const innerW = frameLayer.width - t * 2;
        const innerH = frameLayer.height - t * 2;
        const maxCorner = Math.max(0, Math.min(corner, innerW / 2, innerH / 2));

        if (innerW > 0 && innerH > 0) {
            fctx.save();
            fctx.globalCompositeOperation = 'destination-out';
            if (typeof fctx.roundRect === 'function' && maxCorner > 0) {
                fctx.beginPath();
                fctx.roundRect(innerX, innerY, innerW, innerH, maxCorner);
                fctx.fill();
            } else {
                fctx.fillRect(innerX, innerY, innerW, innerH);
            }
            fctx.restore();
        }

        // 3) Composite prepared frame above all content
        ctx.drawImage(frameLayer, 0, 0);
    }

    function drawVSBadge() {
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;
        const radius = 80;
        ctx.shadowColor = "rgba(0,0,0,0.8)";
        ctx.shadowBlur = 20;
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI, false);
        ctx.fillStyle = '#1e1e1e';
        ctx.fill();
        ctx.lineWidth = 10;
        ctx.strokeStyle = '#FF3366';
        ctx.stroke();
        ctx.shadowColor = "transparent";
        ctx.font = `900 80px "Montserrat"`;
        ctx.fillStyle = "white";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("VS", centerX, centerY + 5);
    }

    function getMousePos(evt) {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        return {
            x: (evt.clientX - rect.left) * scaleX,
            y: (evt.clientY - rect.top) * scaleY
        };
    }

    canvas.addEventListener('mousedown', (e) => {
        const pos = getMousePos(e);
        startX = pos.x;
        startY = pos.y;
        // Try logos first (top-most rendered last → iterate reverse)
        for (let i = logos.length - 1; i >= 0; i--) {
            const logo = logos[i];
            if (hitTestLogo(logo, pos.x, pos.y)) {
                logo.isDragging = true;
                selectedLogoId = logo.id;
                updateLogoSelection();
                canvas.style.cursor = 'move';
                return;
            }
        }
        for (let i = texts.length - 1; i >= 0; i--) {
            const item = texts[i];
            if (!item.text) continue;
            if (pos.x >= item.x - 20 && pos.x <= item.x + item.width + 20 &&
                pos.y >= item.y - 20 && pos.y <= item.y + item.height + 20) {
                item.isDragging = true;
                canvas.style.cursor = 'move';
                return;
            }
        }
    });

    canvas.addEventListener('mousemove', (e) => {
        const pos = getMousePos(e);
        let dragging = false;
        texts.forEach(item => {
            if (item.isDragging) {
                dragging = true;
                const dx = pos.x - startX;
                const dy = pos.y - startY;
                item.x += dx;
                item.y += dy;
            }
        });
        logos.forEach(logo => {
            if (logo.isDragging) {
                dragging = true;
                const dx = pos.x - startX;
                const dy = pos.y - startY;
                logo.x += dx;
                logo.y += dy;
            }
        });
        if (dragging) {
            startX = pos.x;
            startY = pos.y;
            renderCanvas();
        } else {
            let hovering = false;
            for (let i = logos.length - 1; i >= 0; i--) {
                if (hitTestLogo(logos[i], pos.x, pos.y)) { hovering = true; break; }
            }
            if (!hovering) {
                for (let i = 0; i < texts.length; i++) {
                    const item = texts[i];
                    if (item.text && pos.x >= item.x - 20 && pos.x <= item.x + item.width + 20 &&
                        pos.y >= item.y - 20 && pos.y <= item.y + item.height + 20) {
                        hovering = true;
                        break;
                    }
                }
            }
            canvas.style.cursor = hovering ? 'grab' : 'default';
        }
    });

    canvas.addEventListener('mouseup', () => {
        texts.forEach(t => t.isDragging = false);
        logos.forEach(l => l.isDragging = false);
        canvas.style.cursor = 'default';
    });
    canvas.addEventListener('mouseout', () => {
        texts.forEach(t => t.isDragging = false);
        logos.forEach(l => l.isDragging = false);
    });

    downloadBtn.addEventListener('click', () => {
        if (!currentBgImage) return;
        const dataURL = canvas.toDataURL('image/jpeg', 0.9);
        const link = document.createElement('a');
        link.download = 'Musicknobs_Thumbnail.jpg';
        link.href = dataURL;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    });
});
