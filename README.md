# ⚽ Bolão da Copa 2026

App full-stack para criar e gerenciar **um ou mais bolões** da Copa do Mundo FIFA 2026
(🇨🇦🇲🇽🇺🇸 · 11 jun – 19 jul). Palpites de placar, ranking ao vivo e "quem avança".

Já vem com **as 48 seleções e os 12 grupos reais** do sorteio de 05/12/2025 e as 104 partidas
(fase de grupos + todo o mata-mata) semeadas automaticamente em cada bolão.

## ✨ O que dá pra fazer

- **Criar quantos bolões quiser** — cada um com seu link e seu admin.
- **Palpitar o placar exato** de todos os jogos (trava no horário de início).
- **Quem avança**: apostar os 2 classificados de cada grupo.
- **Ranking ao vivo** que recalcula sozinho a cada resultado lançado.
- **Pontuação configurável** pelo admin:
  - 🎯 Placar exato (padrão **10**)
  - ↔️ Acertou o vencedor **e** o saldo de gols (padrão **7**)
  - ✅ Acertou só o vencedor/empate (padrão **5**)
  - 🏆 Quem avança, por seleção certa (padrão **5**)
- **Admin** lança os resultados e, no mata-mata, define os times de cada confronto.

## 🚀 Rodar localmente

```bash
npm install
npm start
# abre http://localhost:3000
```

Para desenvolvimento com reload automático: `npm run dev`.

## 🧱 Stack

- **Backend:** Node.js + Express (API REST)
- **Banco:** SQLite via `better-sqlite3` (arquivo `bolao.db`, criado sozinho) — **zero credencial externa**
- **Frontend:** SPA em HTML/CSS/JS puro (sem build), servida pelo próprio Express

Cada bolão é totalmente independente: tem sua própria cópia das 104 partidas e seus
próprios resultados, então vários grupos de amigos podem usar a mesma instância sem se misturar.

## 🔧 Configuração

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `PORT`   | `3000` | Porta do servidor |
| `DB_PATH`| `./bolao.db` | Caminho do arquivo SQLite |

## ☁️ Deploy

### 🚀 Deploy de 1 clique

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/cebols/bolaodobonde/tree/claude/epic-allen-r6h24a)

> O botão acima lê o `render.yaml` deste repositório e cria o serviço automaticamente.
> Em ~2 min o Render te dá uma URL pública `https://bolao-copa-2026.onrender.com`.
> **Atenção:** no plano *free* o serviço hiberna e o SQLite reseta — para manter os
> palpites, mude `plan: free` para `starter` no `render.yaml` (ativa o disco persistente).

### Outras opções

O app é Node + SQLite self-contained e sobe em qualquer lugar que rode Node:

- **Docker:** `docker build -t bolao . && docker run -p 3000:3000 -v $PWD/data:/data bolao`
- **Fly.io:** já tem `fly.toml` com volume persistente — `fly launch --copy-config --now`
  e depois `fly volumes create bolao_data --size 1`.
- **Railway:** detecta o Node automaticamente (`npm start`). Crie um *Volume* e aponte
  `DB_PATH` para ele (ex.: `/data/bolao.db`).
- **VPS:** `npm install --omit=dev && npm start` atrás de um Nginx/Caddy.

> Quer trocar SQLite por Postgres/Supabase no futuro? Toda a lógica de banco está isolada
> em `server/db.js` — basta reimplementar as funções de lá.

## 🔐 Como funciona o acesso

- **Admin:** ao criar o bolão você recebe um *token de admin* (guardado no seu navegador e
  exibido no painel). Ele dá acesso a lançar resultados e mudar a pontuação.
- **Participantes:** entram pelo link com **nome + PIN**. O PIN serve para voltar e editar
  os palpites. PINs são guardados com hash (SHA-256), não em texto puro.

## 📁 Estrutura

```
server/
  index.js   # API Express + servidor estático
  db.js      # SQLite, schema, criação de bolão e regras de pontuação
data/
  wc2026.js  # 48 seleções, 12 grupos reais, bandeiras e gerador das 104 partidas
public/
  index.html, styles.css, app.js   # interface (SPA)
```

## 📊 Regras de pontuação (detalhe)

Para cada jogo, vale **a maior faixa aplicável** (não acumula):

1. Placar exato → `pts_exact`
2. Mesmo vencedor **e** mesmo saldo de gols → `pts_goaldiff`
3. Mesmo vencedor/empate (saldo diferente) → `pts_outcome`
4. Errou o resultado → 0

"Quem avança" pontua quando **todos os 6 jogos do grupo terminam**: `pts_advance` por
seleção prevista que ficou no top 2 (desempate por pontos → saldo → gols pró).

---

As datas/horários das partidas são aproximados e podem ser ajustados pelo admin de cada bolão.
