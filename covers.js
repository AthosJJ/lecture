/* Couvertures de livres.
   1. Google Books : pendant la saisie du titre, des livres sont proposés avec
      leur couverture, leurs auteurs et leur nombre de pages. La clé d'API
      n'est ni dans le code ni dans le dépôt : l'app la lit, une fois
      connectée, dans le document Firestore config/googlebooks (champ
      apiKey), rempli dans la console Firebase. Sans clé, pas de suggestions.
      La couverture reste un simple lien vers l'image de Google Books.
   2. Photo : la couverture prise en photo est réduite en vignette JPEG de
      30 Ko au plus, gardée dans le livre (data URL), sans Cloud Storage. */

const API = 'https://www.googleapis.com/books/v1/volumes';
export const MAX_PHOTO_CHARS = 30000; // 30 Ko au plus dans Firestore

let apiKey = '';

export function setBooksKey(key) { apiKey = typeof key === 'string' ? key.trim() : ''; }
export const booksSearchReady = () => Boolean(apiKey);
export const googleBooksPage = (id) => 'https://books.google.com/books?id=' + encodeURIComponent(id);

/* Image de Google Books en https, sans l'effet « page cornée ». */
const secureCover = (url) => url.replace(/^http:\/\//, 'https://').replace(/&edge=curl/, '');

/* Couverture acceptable dans un livre : image https, ou vignette en data URL. */
export function validCover(v) {
  return typeof v === 'string'
    && (/^https:\/\/[^\s"'<>]+$/.test(v) || (/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v) && v.length <= MAX_PHOTO_CHARS));
}

/* Livres correspondant à la recherche (8 au plus, les éditions françaises
   d'abord, une seule par titre et auteurs). */
export async function searchBooks(query, signal) {
  const params = new URLSearchParams({
    q: query,
    maxResults: '12',
    printType: 'books',
    fields: 'items(id,volumeInfo(title,subtitle,authors,pageCount,publishedDate,imageLinks(thumbnail,smallThumbnail),language))',
    key: apiKey
  });
  const res = await fetch(`${API}?${params}`, { signal });
  if (!res.ok) {
    const err = new Error('Google Books : HTTP ' + res.status);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  const seen = new Set();
  return (data.items || [])
    .map((item) => {
      const v = item.volumeInfo || {};
      if (!item.id || !v.title) return null;
      const img = v.imageLinks && (v.imageLinks.thumbnail || v.imageLinks.smallThumbnail);
      return {
        id: item.id,
        title: v.title,
        subtitle: v.subtitle || '',
        authors: (v.authors || []).join(', '),
        pages: v.pageCount > 0 ? v.pageCount : null,
        year: String(v.publishedDate || '').slice(0, 4),
        cover: img ? secureCover(img) : '',
        fr: v.language === 'fr'
      };
    })
    .filter(Boolean)
    .sort((a, b) => (b.fr - a.fr) || (Boolean(b.cover) - Boolean(a.cover)))
    .filter((b) => {
      const key = (b.title + '|' + b.authors).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8);
}

/* Photo → vignette au format d'une couverture (2:3), recadrée au centre,
   compressée jusqu'à tenir dans 30 Ko. null si l'image est illisible. */
export async function photoThumbnail(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const W0 = img.naturalWidth;
    const H0 = img.naturalHeight;
    if (!W0 || !H0) return null;
    let sw = W0;
    let sh = W0 * 1.5;
    if (sh > H0) { sh = H0; sw = H0 / 1.5; }
    const sx = (W0 - sw) / 2;
    const sy = (H0 - sh) / 2;
    for (const [w, q] of [[240, 0.82], [240, 0.68], [200, 0.62], [160, 0.58], [120, 0.5]]) {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = Math.round(w * 1.5);
      const ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
      const data = c.toDataURL('image/jpeg', q);
      if (data.length <= MAX_PHOTO_CHARS) return data;
    }
    return null;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}
