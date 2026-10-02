# NFe Distribuição - DFe Manager

Sistema para consulta e manifestação de Notas Fiscais Eletrônicas (NFe) através do serviço NFeDistribuicaoDFe da SEFAZ. Baixa automaticamente XMLs, gera DANFEs em PDF e organiza tudo por unidade/filial.

## Recursos

- **Sincronização automática** com a SEFAZ (NFeDistribuicaoDFe) a cada 2 horas
- **Manifestação** automática de ciência da operação para notas pendentes
- **Download de XML e PDF (DANFE)** organizados por CNPJ/ano/mês
- **Gestão de unidades/filiais** compartilhando a mesma raiz de CNPJ
- **Certificado digital A1** (upload do .pfx com validade e alertas de vencimento)
- **Dashboard** com estatísticas, filtros por unidade e período

## Arquitetura

- **Frontend:** React + TypeScript + Tailwind CSS (Vite)
- **Backend:** Express.js (Node.js) com TypeScript
- **Banco de dados:** PostgreSQL 16 (container Docker)
- **Arquivos:** XML e PDF armazenados em disco no servidor

## Pré-requisitos

- Docker e Docker Compose instalados no servidor

## Instalação

### 1. Configurar variáveis de ambiente

Edite o arquivo `.env`:

```env
# Postgres
POSTGRES_USER=nfe_user
POSTGRES_PASSWORD=nfe_pass
POSTGRES_DB=nfe_db

# Caminho no servidor onde XML/PDF serão salvos
FILES_DIR=/opt/nfe-dados

# Aplicação
AMBIENTE=2
SYNC_CRON=0 */2 * * *
PORT=4000
```

| Variável | Descrição | Padrão |
|---|---|---|
| `POSTGRES_USER` | Usuário do banco | `nfe_user` |
| `POSTGRES_PASSWORD` | Senha do banco | `nfe_pass` |
| `POSTGRES_DB` | Nome do banco | `nfe_db` |
| `FILES_DIR` | Pasta no servidor para XML/PDF | `/opt/nfe-dados` |
| `AMBIENTE` | `1` = Produção, `2` = Homologação | `2` |
| `SYNC_CRON` | Expressão cron da sincronização automática | `0 */2 * * *` |
| `PORT` | Porta da aplicação | `4000` |

### 2. Criar a pasta de arquivos

```bash
mkdir -p /opt/nfe-dados
```

> Altere o caminho se mudou a variável `FILES_DIR` no `.env`.

### 3. Subir os containers

```bash
docker-compose up -d
```

Isso sobe dois containers:

- **postgres** — banco de dados PostgreSQL (cria as tabelas automaticamente na primeira inicialização)
- **nfe-manager** — a aplicação (frontend + backend)

### 4. Acessar

Abra `http://localhost:4000` no navegador.

## Uso

### 1. Cadastrar o certificado digital

Na aba **Certificado**, faça upload do arquivo `.pfx` (A1) da matriz e informe a senha. O sistema extrai automaticamente o CNPJ, validade e emissor.

### 2. Cadastrar unidades

Na aba **Unidades**, cadastre as filiais da empresa. Todas devem compartilhar a mesma raiz de CNPJ (8 primeiros dígitos) do certificado.

### 3. Sincronizar

Na aba **Sincronização**, clique em **Sincronizar Agora** ou aguarde a execução automática (a cada 2 horas por padrão). O sistema:

1. Consulta a SEFAZ por novos documentos (NFeDistribuicaoDFe)
2. Baixa os XMLs completos das notas já disponibilizadas
3. Gera o DANFE em PDF para cada nota baixada
4. Envia manifestação de ciência da operação para notas pendentes

### 4. Visualizar e baixar notas

Na aba **Notas Fiscais**, filtre por unidade e período. Baixe XML e PDF individualmente pelos botões na tabela.

## Estrutura de arquivos

```
projeto/
├── db/
│   └── init.sql              # Script de criação das tabelas (executado automaticamente)
├── docker-compose.yml        # Orquestra postgres + aplicação
├── Dockerfile                # Build multi-stage (frontend + backend)
├── .env                      # Variáveis de ambiente
├── server/                   # Backend Express
│   ├── index.ts              # Servidor + rotas da API
│   ├── db.ts                 # Conexão com PostgreSQL
│   └── services/
│       ├── certificado.ts    # Upload e parsing do certificado A1
│       ├── sefaz.ts          # Consulta e manifestação na SEFAZ
│       ├── sincronizar.ts    # Orquestra a sincronização completa
│       ├── danfe.ts          # Geração de DANFE em PDF
│       └── files.ts          # Leitura/escrita de arquivos em disco
└── src/                      # Frontend React
    ├── App.tsx               # Layout principal + navegação
    ├── lib/
    │   ├── api.ts            # Chamadas à API do backend
    │   └── types.ts          # Tipos e formatadores
    └── pages/
        ├── NotasPage.tsx
        ├── UnidadesPage.tsx
        ├── CertificadoPage.tsx
        └── SincronizacaoPage.tsx
```

## Comandos

| Comando | Descrição |
|---|---|
| `docker-compose up -d` | Sobe os containers em background |
| `docker-compose down` | Para e remove os containers |
| `docker-compose logs -f` | Acompanha os logs da aplicação |
| `docker-compose restart nfe-manager` | Reinicia apenas a aplicação |

### Desenvolvimento local (sem Docker)

```bash
npm install
npm run dev          # Frontend (Vite, porta 5173)
npm run dev:server   # Backend (Express, porta 4000)
```

O Vite encaminha as chamadas `/api` para `http://localhost:4000` automaticamente.

## Banco de dados

O PostgreSQL roda no container com um volume persistente (`postgres_data`). As tabelas são criadas automaticamente na primeira inicialização através do script `db/init.sql`.

### Tabelas

| Tabela | Descrição |
|---|---|
| `unidades` | Filiais da empresa (nome, CNPJ, UF, raiz CNPJ) |
| `notas` | Notas fiscais baixadas (chave de acesso, status, XML/PDF) |
| `sync_control` | Estado da sincronização (último NSU, status, contador) |
| `certificado` | Metadados do certificado (CNPJ, validade, emissor) |
| `certificado_dados` | Arquivo .pfx e senha (acessado apenas pelo backend) |

## Backup

### Banco de dados

```bash
docker-compose exec postgres pg_dump -U nfe_user nfe_db > backup_$(date +%Y%m%d).sql
```

### Arquivos XML/PDF

Os arquivos ficam na pasta definida por `FILES_DIR` (padrão `/opt/nfe-dados`). Faça backup dessa pasta periodicamente.

## Troubleshooting

**Erro: "Nenhum certificado cadastrado"**
Faça upload do certificado .pfx na aba Certificado.

**Erro SOAP da SEFAZ**
Verifique se o certificado está válido e se o ambiente (produção/homologação) está correto no `.env`.

**Arquivo XML/PDF não encontrado no disco**
O caminho salvo no banco aponta para o disco local. Se você restaurou o banco de outro servidor, copie também a pasta de arquivos.

**Container do Postgres não inicia**
Verifique se a porta 5433 não está em uso por outro processo no servidor.
