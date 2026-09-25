# Lecture — Ma bibliothèque

PWA installable de suivi de lecture : livres, articles et podcasts, notes, citations avec numéro de page, progression, statistiques. 100 % vanilla (HTML/CSS/JS), sans backend ni dépendance — toutes les données restent sur l'appareil (IndexedDB).

## Fonctionnalités

- **Bibliothèque** classée par statut (en cours / à lire / terminé) avec barre de progression, recherche globale (titres, auteurs, notes **et** citations) et filtre par tag.
- **Citation rapide** : le bouton flottant « Citation » (bibliothèque et citations) ouvre directement la citation du livre en cours ; s'il y en a plusieurs, on choisit le livre d'un toucher.
- **Fiche livre** : boutons « Citation » et « Note » toujours visibles en bas, onglets Citations / Notes avec compteurs, mise à jour rapide de la page courante (−, +, +10), nombre de pages réglable directement sur la fiche, note sur 5 étoiles, dates, tags.
- **Citations** : page pré-remplie avec la page où l'on en est (une citation plus loin fait avancer la progression), tags suggérés d'un toucher, vue « toutes mes citations » filtrable par livre ou par tag, affichée en serif élégant.
- **Gestes** : toucher une note ou une citation pour la modifier, la glisser vers la gauche pour la supprimer ; les formulaires se ferment en les glissant vers le bas. Chaque suppression peut être annulée depuis le message qui s'affiche.
- **Formulaires** : « Annuler / Enregistrer » toujours visibles en haut, même clavier ouvert ; ajout de livre réduit à l'essentiel (le reste sous « Plus de détails ») ; brouillon gardé automatiquement si l'on ferme par erreur.
- **Dictée vocale** : sur iOS, le bouton « Dicter » ouvre le clavier et guide vers son micro — c'est la dictée d'Apple, sur l'appareil, qui marche hors ligne (l'API web de dictée est bloquée par Apple dans les web apps installées, [bug WebKit #225298](https://bugs.webkit.org/show_bug.cgi?id=225298), et instable dans Safari iOS). Sur Android/desktop, reconnaissance Web Speech directe.
- **Scan de texte (OCR)**, 100 % sur l'appareil et hors ligne :
  1. « Scanner » ouvre l'appareil photo (« Galerie » pour une photo existante) ;
  2. on **encadre le passage** voulu (poignées, déplacement, « Tout ») — indispensable sur un livre ouvert, sinon les lignes des deux pages se mélangent ;
  3. le passage est lu à pleine résolution (débruitage + binarisation adaptative, modèle français Tesseract `best_int`) pendant que le moteur a démarré en arrière-plan ;
  4. on coche les lignes à garder, puis « Insérer » : lignes jointes, mots coupés en fin de ligne recollés (mots composés conservés), apostrophes typographiques.
  Sur iOS, un appui long sur l'aperçu du passage permet aussi d'en copier le texte (Live Text).
- **Statistiques** : compteurs par statut, pages lues, livres terminés par année, note moyenne.
- **Exports** : notes & citations en Markdown (bibliothèque entière ou fiche seule), sauvegarde/restauration complète en JSON. Sur iPhone, l'export passe par la feuille de partage native.
- **Hors ligne complet** : service worker avec mise en cache de l'app shell et du moteur OCR ; les mises à jour s'appliquent sans jamais interrompre une saisie ; mode sombre automatique ; interface mobile-first au format iPhone (zones sûres, barre d'onglets translucide).

## Déploiement sur GitHub Pages

Tous les chemins sont relatifs : l'app fonctionne servie depuis un sous-chemin.

1. Dans le dépôt : **Settings → Pages → Source : Deploy from a branch**, choisir la branche `main` et le dossier `/ (root)`.
2. Ouvrir `https://<utilisateur>.github.io/<repo>/`.

Après chaque mise à jour, incrémenter `VERSION` dans `sw.js` (et `APP_VERSION` dans `app.js`) pour invalider le cache. Sur l'appareil, la mise à jour s'installe au lancement suivant ; le bouton **Rechercher une mise à jour** (écran Stats → Données) la force.

## Installation sur iPhone (iOS 16.4+)

1. Ouvrir l'URL dans **Safari**.
2. Partager → **Sur l'écran d'accueil**.
3. L'app se lance en plein écran et fonctionne hors ligne.

> Les données vivent dans IndexedDB sur l'appareil. iOS peut purger le stockage d'une web app longtemps inutilisée : pensez à faire une sauvegarde JSON de temps en temps (écran Stats → Données).

## Structure

```
index.html        Coque de l'app (écrans, feuilles modales, recadrage, barre d'onglets)
styles.css        Design système : variables, mode sombre, animations
app.js            Logique : routage par hash, rendu, formulaires, gestes, OCR, exports
db.js             Couche IndexedDB (books / notes / quotes)
sw.js             Service worker (cache de l'app shell)
manifest.json     Manifeste PWA
icons/            Icônes PNG (180, 192, 512, maskable)
vendor/tesseract/ Moteur OCR local (Tesseract.js 5 + modèle français « best_int »)
tools/make-icons.mjs   Régénère les icônes : node tools/make-icons.mjs
```
