# Socrate - Runbook d'exploitation (vivant)

Ce document est la reference unique pour demarrer, verifier et depanner Socrate.

Regle de maintenance:
- Ce document doit rester a jour a chaque changement d'infrastructure.
- Quand une solution temporaire est remplacee par une solution permanente:
  - supprimer la section temporaire (ou la marquer "Retiree")
  - garder uniquement la procedure permanente.

---

## 1) Demarrage standard (recommande)

Commande unique:

```bash
npm run dev:full
```

Cette commande lance:
- Neo4j + Chroma (Docker)
- Serveur de replication (port 3213)
- Application Vite (port 3001)

Raccourcis dans le terminal `dev:full`:
- `q`: quitter tous les services lances par le runner
- `r`: redemarrer Vite
- `p`: redemarrer le serveur de replication

---

## 2) URLs utiles

- App Socrate: `http://127.0.0.1:3001`
- Neo4j Browser: `http://127.0.0.1:7474`
- Chroma heartbeat: `http://127.0.0.1:8000/api/v1/heartbeat`
- Replication health: `http://127.0.0.1:3213/health`

Note: `http://127.0.0.1:3213/replicate` est un endpoint `POST` (un `GET` renverra "Cannot GET /replicate").

---

## 3) Configuration attendue dans l'app

Dans `Parametres > Etat de synchronisation`:
- Backend: `hybrid` (ou `neo4j_chroma`)
- Endpoint replication: `http://127.0.0.1:3213/replicate`

Resultat attendu apres sauvegarde d'une analyse:
- `pending` monte puis redescend
- `synced` augmente
- `failed` reste a 0 si les services sont disponibles

---

## 4) Verification rapide de bout-en-bout

1. Lancer `npm run dev:full`
2. Verifier:
   - `http://127.0.0.1:3213/health` -> `ok: true`, `neo4j.ok: true`, `chroma.ok: true`
3. Dans l'app:
   - faire une analyse + sauvegarde
   - confirmer evolution des compteurs (`pending -> synced`)

---

## 5) Depannage

### A) PowerShell bloque npm (Execution Policy)
Utiliser:

```bash
npm.cmd run dev:full
```

### B) Port 3213 deja utilise
Identifier le PID:

```bash
netstat -ano | findstr :3213
```

Tuer le process:

```bash
taskkill /PID <PID> /F
```

Puis relancer `npm run dev:full`.

### C) Chroma repond "detail not found" sur `/`
C'est normal. Tester:
- `http://127.0.0.1:8000/api/v1/heartbeat`

### D) Neo4j demande un mot de passe inconnu
Verifier le fichier `.env.neo4j-chroma`:
- `NEO4J_AUTH=neo4j/<mot_de_passe>`

Si vous utilisez un mot de passe personnalise:
- mettre la meme valeur dans `.env.neo4j-chroma`
- redemarrer les conteneurs Neo4j/Chroma
- redemarrer le serveur de replication (pour relire les variables d'environnement)

`dev:full` lit automatiquement `NEO4J_AUTH` depuis `.env.neo4j-chroma` pour le serveur de replication.

---

## 6) Etat temporaire vs permanent

Etat actuel:
- Replication "reelle" via `scripts/replicationServer.mjs` vers Neo4j + Chroma.
- Mode mock encore disponible pour tests (`npm run replication:mock`) - TEMPORAIRE.

Quand la phase sera stabilisee:
- retirer le mode mock du runbook principal
- garder uniquement le flux permanent `dev:full` + replication server.
