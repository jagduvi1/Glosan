// Genererar en delningsbild för quizresultat och försöker dela via
// Web Share API. Faller tillbaka på clipboard om Web Share saknas.

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export async function generateShareImage({ correct, total, listTitle, streak = 0, isPerfect = false }) {
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 630;
  const ctx = canvas.getContext('2d');

  // Bakgrund
  ctx.fillStyle = '#F4EAD0';
  ctx.fillRect(0, 0, 1200, 630);

  // Marker-border
  ctx.strokeStyle = '#1F1B16';
  ctx.lineWidth = 6;
  roundedRect(ctx, 20, 20, 1160, 590, 20);
  ctx.stroke();

  // Försök ladda Glo-mascot
  try {
    const glo = await loadImage('/assets/glo-mascot.svg');
    ctx.drawImage(glo, 80, 130, 360, 360);
  } catch {
    // Fallback: enkel cirkel
    ctx.fillStyle = '#FF6B6B';
    ctx.beginPath();
    ctx.arc(260, 310, 140, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#1F1B16';
    ctx.lineWidth = 6;
    ctx.stroke();
  }

  // Resultatet — stora siffror
  ctx.fillStyle = '#1F1B16';
  ctx.font = 'bold 170px -apple-system, "Segoe UI", Arial, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(`${correct}/${total}`, 540, 130);

  // "rätt på"
  ctx.font = '600 34px -apple-system, "Segoe UI", Arial, sans-serif';
  ctx.fillStyle = '#5A5147';
  ctx.fillText('rätt på', 540, 320);

  // Listans titel
  ctx.fillStyle = '#1F1B16';
  ctx.font = 'bold 44px -apple-system, "Segoe UI", Arial, sans-serif';
  const titleStr = listTitle && listTitle.length > 24 ? `${listTitle.slice(0, 22)}…` : (listTitle || 'min glos-lista');
  ctx.fillText(titleStr, 540, 365);

  // Perfekt-stämpel
  if (isPerfect) {
    ctx.fillStyle = '#FFC93C';
    roundedRect(ctx, 540, 430, 230, 50, 10);
    ctx.fill();
    ctx.strokeStyle = '#1F1B16';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = '#1F1B16';
    ctx.font = 'bold 28px -apple-system, "Segoe UI", Arial, sans-serif';
    ctx.fillText('✨ PERFEKT RUNDA', 555, 442);
  } else if (streak > 0) {
    ctx.font = '600 30px -apple-system, "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#5A5147';
    ctx.fillText(`🔥 ${streak} ${streak === 1 ? 'dag' : 'dagar'} i rad`, 540, 440);
  }

  // glosan.app sticker
  ctx.fillStyle = '#FF6B6B';
  roundedRect(ctx, 540, 510, 220, 56, 14);
  ctx.fill();
  ctx.strokeStyle = '#1F1B16';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = '#FBF5E6';
  ctx.font = 'bold 30px -apple-system, "Segoe UI", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('glosan.app', 650, 540);

  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (!blob) return resolve(null);
      const file = new File([blob], 'glosan-resultat.png', { type: 'image/png' });
      resolve(file);
    }, 'image/png', 0.92);
  });
}

export function buildShareText({ correct, total, listTitle, streak = 0, isPerfect = false }) {
  const parts = [];
  if (isPerfect) {
    parts.push(`Perfekt runda! ${correct}/${total} på ${listTitle || 'min glos-lista'} i Glosan 🎉`);
  } else {
    parts.push(`Jag fick ${correct}/${total} på ${listTitle || 'min glos-lista'} i Glosan!`);
  }
  if (streak > 1) parts.push(`🔥 ${streak} dagar i rad`);
  return parts.join(' · ');
}

export async function shareResult(payload) {
  const text = buildShareText(payload);
  const url = 'https://glosan.app';

  // Försök med Web Share + fil (mobil, modern)
  try {
    const file = await generateShareImage(payload);
    if (file && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ title: 'Glosan', text, url, files: [file] });
      return { method: 'share-with-file' };
    }
  } catch (err) {
    if (err.name === 'AbortError') return { method: 'cancelled' };
    console.warn('Share with file failed:', err);
  }

  // Web Share utan fil (vissa browsers)
  try {
    if (navigator.share) {
      await navigator.share({ title: 'Glosan', text, url });
      return { method: 'share-text' };
    }
  } catch (err) {
    if (err.name === 'AbortError') return { method: 'cancelled' };
    console.warn('Share failed:', err);
  }

  // Fallback: returnera signal till komponenten att visa modal med
  // copy + förvalda sociala knappar
  return { method: 'fallback' };
}
