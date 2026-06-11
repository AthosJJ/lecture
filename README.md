# Lecture — Ma bibliothèque

PWA installable de suivi de lecture : livres et articles, notes, citations avec numéro de page, progression, statistiques. 100 % vanilla (HTML/CSS/JS), sans backend ni dépendance — toutes les données restent sur l'appareil (IndexedDB).

## Fonctionnalités

- **Bibliothèque** classée par statut (en cours / à lire / terminé) avec barre de progression, recherche globale (titres, auteurs, notes **et** citations) et filtre par tag.
- **Fiche livre** : onglets Notes / Citations, mise à jour rapide de la page courante (−, +, +10), note sur 5 étoiles, dates de début/fin, tags, type livre ou article.
- **Citations** : chacune avec son numéro de page et ses tags ; vue « toutes mes citations » filtrable par livre ou par tag, affichée en serif élégant.
- **Dictée vocale** : bouton micro dans les formulaires de citation et de note (Web Speech API, reconnaissance en français). Apple bloque cette API dans les web apps installées sur l'écran d'accueil ([bug WebKit #225298](https://bugs.webkit.org/show_bug.cgi?id=225298)) : dans ce cas le bouton bascule automatiquement sur la dictée Apple du clavier iOS (même moteur, sur l'appareil, fonctionne hors ligne).
- **Scan de texte (OCR)** : photographiez une page, le texte est reconnu **sur l'appareil** (Tesseract.js embarqué, modèle français — aucune donnée n'est envoyée sur un serveur, fonctionne hors ligne). Les lignes reconnues sont sélectionnables une à une avant insertion dans la citation.
- **Statistiques** : compteurs par statut, pages lues, livres terminés par année, note moyenne.
- **Exports** : notes & citations en Markdown (bibliothèque entière ou fiche seule), sauvegarde/restauration complète en JSON. Sur iPhone, l'export passe par la feuille de partage native.
- **Hors ligne complet** : service worker avec mise en cache de l'app shell ; mode sombre automatique ; interface mobile-first au format iPhone (zones sûres, barre d'onglets translucide).

## Déploiement sur GitHub Pages

Tous les chemins sont relatifs : l'app fonctionne servie depuis un sous-chemin.

1. Dans le dépôt : **Settings → Pages → Source : Deploy from a branch**, choisir la branche et le dossier `/ (root)`.
2. Ouvrir `https://<utilisateur>.github.io/<repo>/`.

Après chaque mise à jour, incrémenter `VERSION` dans `sw.js` pour invalider le cache. Sur l'appareil, le bouton **Rechercher une mise à jour** (écran Stats → Données) force la récupération de la nouvelle version.

## Installation sur iPhone (iOS 16.4+)

1. Ouvrir l'URL dans **Safari**.
2. Partager → **Sur l'écran d'accueil**.
3. L'app se lance en plein écran et fonctionne hors ligne.

> Les données vivent dans IndexedDB sur l'appareil. iOS peut purger le stockage d'une web app longtemps inutilisée : pensez à faire une sauvegarde JSON de temps en temps (écran Stats → Données).

## Structure

```
index.html        Coque de l'app (écrans, feuilles modales, barre d'onglets)
styles.css        Design système : variables, mode sombre, animations
app.js            Logique : routage par hash, rendu, formulaires, exports
db.js             Couche IndexedDB (books / notes / quotes)
sw.js             Service worker (cache de l'app shell)
manifest.json     Manifeste PWA
icons/            Icônes PNG (180, 192, 512, maskable)
vendor/tesseract/ Moteur OCR local (Tesseract.js 5 + modèle français « fast »)
tools/make-icons.mjs   Régénère les icônes : node tools/make-icons.mjs
```
