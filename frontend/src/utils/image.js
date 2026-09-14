// Nerskalning av en vald/fotad bild innan den skickas till AI-tolkningen.
//
// En mobilbild är 2–12 MB i original. Claude vinner ingenting på högre
// upplösning än ~1600 px för ett glosblad, så vi skalar ner i webbläsaren:
// det är skillnaden mellan en uppladdning som funkar på 4G och en som inte
// gör det, och det håller tokenkostnaden nere.
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.8;

// Originalfilen läses in i minnet, så stoppa orimliga filer tidigt med ett
// begripligt fel i stället för att låta fliken krascha.
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

async function loadBitmap(file) {
  try {
    // 'from-image' roterar enligt EXIF. Utan den kommer mobilbilder in
    // liggande — telefonen sparar sensorbilden som den är och lägger
    // rotationen i metadata, och canvas struntar i den som standard.
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return await createImageBitmap(file);
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Kunde inte läsa bilden.'));
    // result är en data-URL; backend vill ha enbart base64-delen.
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.readAsDataURL(blob);
  });
}

/**
 * Skalar ner en bild till max `maxEdge` px på längsta sidan och kodar den
 * som JPEG-base64. Returnerar { base64, mediaType, bytes }.
 */
export async function downscaleImage(file, { maxEdge = MAX_EDGE, quality = JPEG_QUALITY } = {}) {
  if (!file || !file.type?.startsWith('image/')) {
    throw new Error('Välj en bildfil.');
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error('Bilden är för stor. Ta en ny bild med lägre upplösning.');
  }

  const bitmap = await loadBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  // Vit botten först: JPEG saknar alfakanal, så en PNG med transparens
  // skulle annars bli svart där den är genomskinlig.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) throw new Error('Kunde inte läsa bilden.');

  return { base64: await blobToBase64(blob), mediaType: 'image/jpeg', bytes: blob.size };
}
