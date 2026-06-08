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
- **Banco:** **Postgres** quando `DATABASE_URL` está definida (ex.: Supabase) — recomendado
  para produção/multiplayer. Sem `DATABASE_URL`, cai automaticamente para **SQLite** local
  (`bolao.db`), ótimo para rodar na sua máquina sem nenhuma credencial.
- **Frontend:** SPA em HTML/CSS/JS puro (sem build), servida pelo próprio Express (ou pela CDN da Vercel).

A camada de dados é única (`server/store.js`) e fala com os dois bancos com o mesmo código.
Cada bolão é independente: tem sua própria cópia das 104 partidas e seus próprios resultados,
então vários grupos de amigos usam a mesma instância sem se misturar.

## 🔧 Configuração

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `DATABASE_URL` | _(vazio)_ | String de conexão Postgres (ex.: Supabase). Se definida, usa Postgres; senão, SQLite. |
| `PORT`   | `3000` | Porta do servidor (ignorado na Vercel) |
| `DB_PATH`| `./bolao.db` | Caminho do arquivo SQLite (modo local) |

## ☁️ Deploy

### ⭐ Recomendado: Vercel + Supabase (Postgres)

Backend de verdade, compartilhado e com URL pública. A Vercel faz o build/deploy na infra dela
a cada push (via integração com o GitHub) e conecta no Postgres do Supabase.

1. **Supabase:** crie um projeto em <https://supabase.com>. Em **Project Settings → Database →
   Connection string → URI**, copie a string (use a do **Connection pooler**, porta `6543`,
   ideal para serverless). As tabelas são criadas sozinhas no primeiro acesso.
2. **Vercel:** em <https://vercel.com>, **Add New → Project → Import** este repositório do GitHub.
3. Em **Environment Variables**, adicione `DATABASE_URL` com a string do Supabase.
4. **Deploy.** A Vercel te dá uma URL `https://<projeto>.vercel.app`. Pronto, no ar. 🎉

O `vercel.json` já está configurado: `/api/*` vai para a função serverless (Express) e o
restante é servido como estático.

### 🚀 Alternativa de 1 clique: Render (SQLite)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/cebols/bolaodobonde/tree/claude/epic-allen-r6h24a)

> Lê o `render.yaml` e cria o serviço sozinho. No plano *free* o SQLite reseta quando o
> serviço hiberna — para manter os palpites, defina `DATABASE_URL` (Supabase) nas env vars
> ou troque `plan: free` por `starter` (disco persistente).

### Outras opções

- **Docker:** `docker build -t bolao . && docker run -p 3000:3000 -v $PWD/data:/data bolao`
- **Fly.io:** `fly.toml` com volume persistente — `fly launch --copy-config --now` e
  `fly volumes create bolao_data --size 1`. Defina `DATABASE_URL` para usar Postgres.
- **Railway:** detecta o Node automaticamente (`npm start`). Use um Postgres da Railway e
  aponte `DATABASE_URL`, ou um Volume com `DB_PATH`.
- **VPS:** `npm install --omit=dev && npm start` atrás de um Nginx/Caddy.

## 🔐 Como funciona o acesso

- **Admin:** ao criar o bolão você recebe um *token de admin* (guardado no seu navegador e
  exibido no painel). Ele dá acesso a lançar resultados e mudar a pontuação.
- **Participantes:** entram pelo link com **nome + PIN**. O PIN serve para voltar e editar
  os palpites. PINs são guardados com hash (SHA-256), não em texto puro.

## 📁 Estrutura

```
server/
  app.js     # app Express (rotas da API + estático) — reusado local e na Vercel
  index.js   # listener para `npm start` / Docker / Render / Fly
  store.js   # camada de dados (Postgres OU SQLite), schema e regras de pontuação
api/
  index.js   # entrada serverless da Vercel (exporta o app Express)
data/
  wc2026.js  # 48 seleções, 12 grupos reais, bandeiras e gerador das 104 partidas
public/
  index.html, styles.css, app.js   # interface (SPA)
vercel.json  # roteamento Vercel: /api -> função, resto -> estático
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
