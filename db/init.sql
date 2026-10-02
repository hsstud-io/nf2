-- NFe Distribution System - Database Schema
-- Runs automatically on first container startup via /docker-entrypoint-initdb.d/

-- Enum types
DO $$ BEGIN
  CREATE TYPE nota_status AS ENUM ('pendente', 'manifestada', 'baixada');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE sync_status_enum AS ENUM ('sucesso', 'erro', 'em_andamento');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Unidades table
CREATE TABLE IF NOT EXISTS unidades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  cnpj text NOT NULL UNIQUE,
  cnpj_raiz text NOT NULL,
  uf text NOT NULL DEFAULT 'SP',
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Notas table
CREATE TABLE IF NOT EXISTS notas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chave_acesso text NOT NULL UNIQUE,
  cnpj_unidade text,
  unidade_id uuid REFERENCES unidades(id) ON DELETE SET NULL,
  data_emissao date,
  nsu bigint,
  status nota_status NOT NULL DEFAULT 'pendente',
  valor_total numeric(14,2),
  xml_path text,
  pdf_path text,
  manifesto_enviado boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Sync control table (singleton)
CREATE TABLE IF NOT EXISTS sync_control (
  id integer PRIMARY KEY DEFAULT 1,
  ult_nsu bigint NOT NULL DEFAULT 0,
  max_nsu bigint NOT NULL DEFAULT 0,
  ultima_execucao timestamptz,
  status_ultima_execucao sync_status_enum,
  documentos_processados integer NOT NULL DEFAULT 0,
  mensagem text,
  CONSTRAINT singleton_check CHECK (id = 1)
);

INSERT INTO sync_control (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Certificado table (metadata only)
CREATE TABLE IF NOT EXISTS certificado (
  id integer PRIMARY KEY DEFAULT 1,
  cnpj text,
  cnpj_raiz text,
  validade_inicio date,
  validade_fim date,
  emissor text,
  serial text,
  arquivo_nome text,
  armazenado_em timestamptz DEFAULT now(),
  CONSTRAINT singleton_cert CHECK (id = 1)
);

INSERT INTO certificado (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Certificado dados table (actual .pfx binary + password)
CREATE TABLE IF NOT EXISTS certificado_dados (
  id integer PRIMARY KEY DEFAULT 1,
  pfx_base64 text NOT NULL,
  senha text NOT NULL,
  arquivo_nome text,
  armazenado_em timestamptz DEFAULT now(),
  CONSTRAINT singleton_cert_dados CHECK (id = 1)
);

INSERT INTO certificado_dados (id, pfx_base64, senha) VALUES (1, 'placeholder', 'placeholder')
  ON CONFLICT (id) DO NOTHING;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_notas_cnpj_unidade ON notas (cnpj_unidade);
CREATE INDEX IF NOT EXISTS idx_notas_data_emissao ON notas (data_emissao);
CREATE INDEX IF NOT EXISTS idx_notas_status ON notas (status);
CREATE INDEX IF NOT EXISTS idx_notas_nsu ON notas (nsu);
CREATE INDEX IF NOT EXISTS idx_unidades_cnpj_raiz ON unidades (cnpj_raiz);
