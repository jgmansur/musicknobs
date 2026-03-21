import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const dir = 'public/assets';
const files = fs.readdirSync(dir);

async function optimizeImages() {
  for (const file of files) {
    if (file.match(/\.(jpg|jpeg|png|heic)$/i)) {
      const inputPath = path.join(dir, file);
      const parsed = path.parse(file);
      const outputPath = path.join(dir, `${parsed.name}.webp`);
      
      console.log(`Optimizing ${file}...`);
      try {
        await sharp(inputPath)
          .resize(1920, 1920, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 75 })
          .toFile(outputPath);
          
        console.log(`Saved ${parsed.name}.webp`);
        fs.unlinkSync(inputPath); // Delete the original to save space
      } catch (err) {
        console.error(`Error processing ${file}:`, err);
      }
    }
  }
}

optimizeImages();
