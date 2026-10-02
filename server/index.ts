import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import cron from 'node-cron';
import { pool } from './db.js';
import { sincronizar } from './services/sincronizar.js';
import { consultarSefaz, manifestarSefaz } from './services/sefaz.js';
import { gerarDanfe } from './services/danfe.js';
import { parseCertificado, uploadCertificado } from './services/certificado.js';
import { readFile, fileExists } from './services/files.js';



const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = parseInt(process.env.PORT || '4000', 10);
const AMBIENTE = process.env.AMBIENTE || '2';
const SYNC_CRON = process.env.SYNC_CRON || '0 */2 * * *';

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const asyncHandler =
  (fn: (req: express.Request, res: express.Response) => Promise<void>) =>
  (req: express.Request, res: express.Response) => {
    fn(req, res).catch((err) => {
      console.error('Route error:', err);
      res.status(500).json({ error: err.message || 'Erro interno' });
    });
  };

// ---- Unidades CRUD ----

app.get(
  '/api/unidades',
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query('SELECT * FROM unidades ORDER BY nome');
    res.json(rows);
  }),
);

app.post(
  '/api/unidades',
  asyncHandler(async (req, res) => {
    const { nome, cnpj, cnpj_raiz, uf } = req.body;
    if (!nome || !cnpj || !cnpj_raiz || !uf) {
      res.status(400).json({ error: 'nome, cnpj, cnpj_raiz e uf são obrigatórios' });
      return;
    }
    const { rows } = await pool.query(
      `INSERT INTO unidades (nome, cnpj, cnpj_raiz, uf)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [nome, cnpj, cnpj_raiz, uf]
    );
    res.json(rows[0]);
  }),
);

app.put(
  '/api/unidades/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { nome, cnpj, cnpj_raiz, uf, ativo } = req.body;
    if (!nome || !cnpj || !cnpj_raiz || !uf) {
      res.status(400).json({ error: 'nome, cnpj, cnpj_raiz e uf são obrigatórios' });
      return;
    }
    const { rows } = await pool.query(
      `UPDATE unidades SET nome = $1, cnpj = $2, cnpj_raiz = $3, uf = $4, ativo = $5, updated_at = now() WHERE id = $6 RETURNING *`,
      [nome, cnpj, cnpj_raiz, uf, ativo ?? true, id]
    );
    if (rows.length === 0) {
      res.status(404).json({ error: 'Unidade não encontrada' });
      return;
    }
    res.json(rows[0]);
  }),
);

app.delete(
  '/api/unidades/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    await pool.query('DELETE FROM unidades WHERE id = $1', [id]);
    res.json({ success: true });
  }),
);

// ---- Notas ----

app.get(
  '/api/notas',
  asyncHandler(async (req, res) => {
    const { unidade_id, data_inicio, data_fim } = req.query;
    let query = 'SELECT * FROM notas';
    const conditions: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (unidade_id) {
      conditions.push(`unidade_id = $${idx++}`);
      params.push(unidade_id);
    }
    if (data_inicio) {
      conditions.push(`data_emissao >= $${idx++}`);
      params.push(data_inicio);
    }
    if (data_fim) {
      conditions.push(`data_emissao <= $${idx++}`);
      params.push(data_fim);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    query += ' ORDER BY data_emissao DESC NULLS LAST';

    const { rows } = await pool.query(query, params);
    res.json(rows);
  }),
);

// ---- File downloads ----

app.get(
  '/api/notas/:chave/xml',
  asyncHandler(async (req, res) => {
    const { chave } = req.params;
    const { rows } = await pool.query(
      'SELECT xml_path FROM notas WHERE chave_acesso = $1',
      [chave]
    );
    if (rows.length === 0 || !rows[0].xml_path) {
      res.status(404).json({ error: 'XML não encontrado' });
      return;
    }
    const xmlPath = rows[0].xml_path;
    if (!fileExists(xmlPath)) {
      res.status(404).json({ error: 'Arquivo XML não encontrado no disco' });
      return;
    }
    const data = readFile(xmlPath);
    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Content-Disposition', `attachment; filename="${chave}.xml"`);
    res.send(data);
  }),
);

app.get(
  '/api/notas/:chave/pdf',
  asyncHandler(async (req, res) => {
    const { chave } = req.params;
    const { rows } = await pool.query(
      'SELECT pdf_path FROM notas WHERE chave_acesso = $1',
      [chave]
    );
    if (rows.length === 0 || !rows[0].pdf_path) {
      res.status(404).json({ error: 'PDF não encontrado' });
      return;
    }
    const pdfPath = rows[0].pdf_path;
    if (!fileExists(pdfPath)) {
      res.status(404).json({ error: 'Arquivo PDF não encontrado no disco' });
      return;
    }
    const data = readFile(pdfPath);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${chave}.pdf"`);
    res.send(data);
  }),
);

// ---- Sync Control ----

app.get(
  '/api/sync-control',
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query('SELECT * FROM sync_control WHERE id = 1');
    res.json(rows[0] || null);
  }),
);

// ---- Certificado ----

app.get(
  '/api/certificado',
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query('SELECT * FROM certificado WHERE id = 1');
    res.json(rows[0] || null);
  }),
);

app.post(
  '/api/certificado',
  asyncHandler(async (req, res) => {
    const { action, fileName, fileBase64, senha } = req.body;

    if (!fileBase64 || !senha) {
      res.status(400).json({ error: 'Arquivo e senha são obrigatórios' });
      return;
    }

    if (action === 'parse') {
      const info = await parseCertificado(fileBase64, senha);
      res.json(info);
      return;
    }

    if (action === 'upload') {
      const info = await uploadCertificado(fileBase64, senha, fileName || 'certificado.pfx');
      res.json({ success: true, ...info });
      return;
    }

    res.status(400).json({ error: 'Ação inválida' });
  }),
);

// ---- Sefaz Consultar ----
app.post(
  '/api/sefaz-consultar',
  asyncHandler(async (req, res) => {
    const { ultNSU, ambiente } = req.body;
    const result = await consultarSefaz(ultNSU || '0', ambiente || AMBIENTE);
    res.json(result);
  }),
);

// ---- Sefaz Manifestar ----
app.post(
  '/api/sefaz-manifestar',
  asyncHandler(async (req, res) => {
    const { chaveAcesso, ambiente } = req.body;
    if (!chaveAcesso) {
      res.status(400).json({ error: 'chaveAcesso é obrigatório' });
      return;
    }
    const result = await manifestarSefaz(chaveAcesso, ambiente || AMBIENTE);
    res.json(result);
  }),
);

// ---- Gerar DANFE ----
app.post(
  '/api/gerar-danfe',
  asyncHandler(async (req, res) => {
    const { xmlContent, chaveAcesso, cnpjUnidade, dataEmissao } = req.body;
    if (!xmlContent) {
      res.status(400).json({ error: 'xmlContent é obrigatório' });
      return;
    }
    const result = await gerarDanfe(xmlContent, chaveAcesso, cnpjUnidade, dataEmissao);
    res.json(result);
  }),
);

// ---- Sincronizar ----
app.post(
  '/api/sincronizar',
  asyncHandler(async (req, res) => {
    const ambiente = req.body?.ambiente || AMBIENTE;
    const result = await sincronizar(ambiente);
    res.json(result);
  }),
);

// ---- Health check ----
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ---- Serve frontend static files ----
const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath));

app.use((req, res, next) => {
  if (req.path.startsWith('/notafiscalbaixar/api/')) {
    next();
    return;
  }

  res.sendFile(path.join(distPath, 'index.html'));
});
// ---- Cron: automatic sync ----
if (cron.validate(SYNC_CRON)) {
  cron.schedule(SYNC_CRON, async () => {
    console.log(`[${new Date().toISOString()}] Cron: iniciando sincronização automática...`);
    try {
      const result = await sincronizar(AMBIENTE);
      console.log(`[${new Date().toISOString()}] Cron: sincronização concluída - ${result.mensagem}`);
    } catch (err: any) {
      console.error(`[${new Date().toISOString()}] Cron: erro na sincronização - ${err.message}`);
    }
  });
  console.log(`Cron de sincronização agendado: ${SYNC_CRON} (ambiente: ${AMBIENTE})`);
} else {
  console.warn(`Expressão cron inválida: ${SYNC_CRON}. Sincronização automática desativada.`);
}

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  console.log(`Ambiente Sefaz: ${AMBIENTE === '1' ? 'Produção' : 'Homologação'}`);
});
