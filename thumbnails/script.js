document.addEventListener('DOMContentLoaded', () => {
    // --- 1. PROMPT GENERATOR LOGIC ---
    const formOptions = {
        arquetipo: document.getElementById('arquetipo'),
        sujeto: document.getElementById('sujeto'),
        entorno: document.getElementById('entorno'),
        iluminacion: document.getElementById('iluminacion')
    };
    const generatedPromptEl = document.getElementById('generated-prompt');
    const copyBtn = document.getElementById('copy-prompt-btn');

    function generatePrompt() {
        const arquetipo = formOptions.arquetipo.value;
        const sujetoExp = formOptions.sujeto.value;
        let entorno = formOptions.entorno.value;
        if (entorno === 'custom') {
            entorno = document.getElementById('entorno-custom').value || 'dark high-end recording studio';
        } else if (!entorno) {
            entorno = 'dark high-end recording studio';
        }
        const luces = formOptions.iluminacion.value;

        let basePrompt = `Based on the reference image in my google drive 'Jay Looks 1.jpg', generate a highly realistic professional music producer`;

        if (sujetoExp === 'no subject') {
            basePrompt = `Generate a highly realistic`;
        } else {
            basePrompt += ` with a ${sujetoExp},`;
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
    const canvas = document.getElementById('thumbnail-canvas');
    const ctx = canvas.getContext('2d');
    const imageUpload = document.getElementById('image-upload');
    const uploadArea = document.getElementById('upload-area');
    const textTools = document.getElementById('text-tools');
    const canvasWrapper = document.querySelector('.canvas-wrapper');
    const downloadBtn = document.getElementById('download-btn');

    // Inputs
    const text1Input = document.getElementById('thumb-text-1');
    const text2Input = document.getElementById('thumb-text-2');
    const color1Input = document.getElementById('color-1');
    const color2Input = document.getElementById('color-2');
    const size1Input = document.getElementById('size-1');
    const size2Input = document.getElementById('size-2');
    const fontSelect = document.getElementById('font-family');
    const addVsBtn = document.getElementById('add-vs-btn');

    // Advanced Config
    const letterSpacingInput = document.getElementById('letter-spacing');
    const toggleShadowInput = document.getElementById('toggle-shadow');
    const toggleStrokeInput = document.getElementById('toggle-stroke');

    let currentBgImage = null;
    let showVsBadge = false;

    // Text objects to handle dragging
    const texts = [
        { id: 1, text: '', x: 100, y: 300, color: '#FFFFFF', isDragging: false },
        { id: 2, text: '', x: 100, y: 450, color: '#FF3366', isDragging: false }
    ];

    let startX, startY;

    // Load custom fonts to ensure they render on canvas immediately
    document.fonts.ready.then(() => {
        renderCanvas();
    });

    // Handle Image Upload
    imageUpload.addEventListener('change', handleImageUpload);

    // Drag & Drop for upload area
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('dragover');
    });
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

                // Set default texts to show the user how it works
                if (!text1Input.value) text1Input.value = "NUEVO SECRETO";
                if (!text2Input.value) text2Input.value = "DE MEZCLA";
                texts[0].text = text1Input.value;
                texts[1].text = text2Input.value;

                renderCanvas();
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    }

    // Connect text inputs to canvas rendering
    text1Input.addEventListener('input', (e) => { texts[0].text = e.target.value; renderCanvas(); });
    text2Input.addEventListener('input', (e) => { texts[1].text = e.target.value; renderCanvas(); });
    color1Input.addEventListener('input', (e) => { texts[0].color = e.target.value; renderCanvas(); });
    color2Input.addEventListener('input', (e) => { texts[1].color = e.target.value; renderCanvas(); });
    size1Input.addEventListener('input', renderCanvas);
    size2Input.addEventListener('input', renderCanvas);
    fontSelect.addEventListener('change', renderCanvas);
    letterSpacingInput.addEventListener('input', renderCanvas);
    toggleShadowInput.addEventListener('change', renderCanvas);
    toggleStrokeInput.addEventListener('change', renderCanvas);

    addVsBtn.addEventListener('click', () => {
        showVsBadge = !showVsBadge;
        addVsBtn.textContent = showVsBadge ? 'Quitar "VS"' : 'Añadir "VS"';
        addVsBtn.style.background = showVsBadge ? '#5e6ad2' : 'var(--danger)';
        renderCanvas();
    });

    function renderCanvas() {
        if (!currentBgImage) return;

        // Clear canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // 1. Draw Background Image (Cover/Fill)
        // Calculate aspect ratio to fill 1280x720
        const hRatio = canvas.width / currentBgImage.width;
        const vRatio = canvas.height / currentBgImage.height;
        const ratio = Math.max(hRatio, vRatio);
        const centerShiftX = (canvas.width - currentBgImage.width * ratio) / 2;
        const centerShiftY = (canvas.height - currentBgImage.height * ratio) / 2;

        ctx.drawImage(currentBgImage, 0, 0, currentBgImage.width, currentBgImage.height,
            centerShiftX, centerShiftY, currentBgImage.width * ratio, currentBgImage.height * ratio);

        // 2. Add Vignette / Left Dark Gradient (for text readability)
        const gradient = ctx.createLinearGradient(0, 0, canvas.width * 0.6, 0);
        gradient.addColorStop(0, "rgba(0,0,0,0.8)");
        gradient.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // 3. Draw Texts (Bottom Layer)
        texts.forEach((item, index) => {
            if (!item.text.trim()) return;

            const fontName = fontSelect.value;
            const fontSize = index === 0 ? size1Input.value : size2Input.value;

            // Apply dynamic font size
            ctx.font = `900 ${fontSize}px "${fontName}"`;
            ctx.fillStyle = item.color;
            ctx.textAlign = "left";
            ctx.textBaseline = "top";

            // Support modern Canvas letterSpacing
            ctx.letterSpacing = letterSpacingInput.value + "px";

            // Fix sharp outline spikes piercing through thick fonts like Anton
            ctx.lineJoin = "round";

            // Add strong drop shadow based on manual
            if (toggleShadowInput.checked) {
                ctx.shadowColor = "rgba(0,0,0,0.9)";
                ctx.shadowBlur = 15;
                ctx.shadowOffsetX = 8;
                ctx.shadowOffsetY = 8;
            } else {
                ctx.shadowColor = "transparent";
            }

            // Draw outline for extra pop (Youtube style)
            if (toggleStrokeInput.checked) {
                ctx.lineWidth = 10;
                ctx.strokeStyle = '#000000';
                // Stroke text casts the shadow.
                ctx.strokeText(item.text.toUpperCase(), item.x, item.y);

                // Turn off shadow before filling text so we don't double-shadow and cause the 3D-bending bug
                ctx.shadowColor = "transparent";
                ctx.fillText(item.text.toUpperCase(), item.x, item.y);
            } else {
                // No stroke, just fill text (this casts the shadow)
                ctx.fillText(item.text.toUpperCase(), item.x, item.y);
            }

            // Reset effects for other operations
            ctx.shadowColor = "transparent";
            ctx.shadowBlur = 0;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;
            ctx.letterSpacing = "0px";

            // Calculate width and height for hit detection (dragging)
            const metrics = ctx.measureText(item.text.toUpperCase());
            item.width = metrics.width;
            item.height = parseInt(fontSize, 10); // approx height based on font size
        });

        // 4. Draw VS Badge if active (Top Layer)
        if (showVsBadge) {
            drawVSBadge();
        }
    }

    function drawVSBadge() {
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;
        const radius = 80;

        ctx.shadowColor = "rgba(0,0,0,0.8)";
        ctx.shadowBlur = 20;

        // Circle
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI, false);
        ctx.fillStyle = '#1e1e1e';
        ctx.fill();
        ctx.lineWidth = 10;
        ctx.strokeStyle = '#FF3366'; // Danger/Contrast
        ctx.stroke();

        ctx.shadowColor = "transparent";

        // VS Text
        ctx.font = `900 80px "Montserrat"`;
        ctx.fillStyle = "white";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("VS", centerX, centerY + 5);
    }

    // --- CANVAS DRAG AND DROP ---
    // Handle coordinates relative to the scaled canvas on screen
    function getMousePos(evt) {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        return {
            x: (evt.clientX - rect.left) * scaleX,
            y: (evt.clientY - rect.left) * scaleY
        };
    }

    canvas.addEventListener('mousedown', (e) => {
        const pos = getMousePos(e);
        startX = pos.x;
        startY = pos.y;

        // Check if cursor is over any text (in reverse order so top gets hit first)
        for (let i = texts.length - 1; i >= 0; i--) {
            const item = texts[i];
            if (!item.text) continue;

            if (pos.x >= item.x && pos.x <= item.x + item.width &&
                pos.y >= item.y && pos.y <= item.y + item.height) {
                item.isDragging = true;
                return; // Only drag one at a time
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

        if (dragging) {
            startX = pos.x;
            startY = pos.y;
            renderCanvas();
        } else {
            // Change cursor if hovering over text
            let hovering = false;
            for (let i = 0; i < texts.length; i++) {
                const item = texts[i];
                if (item.text && pos.x >= item.x && pos.x <= item.x + item.width &&
                    pos.y >= item.y && pos.y <= item.y + item.height) {
                    hovering = true;
                    break;
                }
            }
            canvas.style.cursor = hovering ? 'grab' : 'default';
        }
    });

    canvas.addEventListener('mouseup', () => { texts.forEach(t => t.isDragging = false); canvas.style.cursor = 'grab'; });
    canvas.addEventListener('mouseout', () => { texts.forEach(t => t.isDragging = false); canvas.style.cursor = 'default'; });

    // --- DOWNLOAD ---
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
