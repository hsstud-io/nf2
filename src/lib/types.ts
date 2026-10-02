export type NotaStatus = 'pendente' | 'manifestada' | 'baixada';

export interface Unidade {
  id: string;
  nome: string;
  cnpj: string;
  cnpj_raiz: string;
  uf: string;
  ativo: boolean;
  created_at: string;
  updated_at: string;
}

export interface Nota {
  id: string;
  chave_acesso: string;
  cnpj_unidade: string | null;
  unidade_id: string | null;
  data_emissao: string | null;
  nsu: number | null;
  status: NotaStatus;
  valor_total: number | null;
  xml_path: string | null;
  pdf_path: string | null;
  manifesto_enviado: boolean;
  created_at: string;
  updated_at: string;
}

export interface SyncControl {
  id: number;
  ult_nsu: number;
  max_nsu: number;
  ultima_execucao: string | null;
  status_ultima_execucao: 'sucesso' | 'erro' | 'em_andamento' | null;
  documentos_processados: number;
  mensagem: string | null;
}

export interface Certificado {
  id: number;
  cnpj: string | null;
  cnpj_raiz: string | null;
  validade_inicio: string | null;
  validade_fim: string | null;
  emissor: string | null;
  serial: string | null;
  arquivo_nome: string | null;
  armazenado_em: string | null;
}

export function statusLabel(status: NotaStatus): string {
  switch (status) {
    case 'pendente':
      return 'Pendente';
    case 'manifestada':
      return 'Manifestada';
    case 'baixada':
      return 'Baixada';
    default:
      return status;
  }
}

export function statusColor(status: NotaStatus): string {
  switch (status) {
    case 'pendente':
      return 'bg-amber-100 text-amber-800 border-amber-200';
    case 'manifestada':
      return 'bg-blue-100 text-blue-800 border-blue-200';
    case 'baixada':
      return 'bg-emerald-100 text-emerald-800 border-emerald-200';
    default:
      return 'bg-gray-100 text-gray-800 border-gray-200';
  }
}

export function formatCNPJ(cnpj: string): string {
  if (!cnpj || cnpj.length !== 14) return cnpj;
  return cnpj.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
}

export function formatCurrency(value: number | null): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
}

export function formatDate(date: string | null): string {
  if (!date) return '—';
  const d = new Date(date);
  return d.toLocaleDateString('pt-BR');
}

export function formatDateTime(date: string | null): string {
  if (!date) return '—';
  const d = new Date(date);
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function deriveCnpjRaiz(cnpj: string): string {
  return cnpj.length >= 8 ? cnpj.substring(0, 8) : cnpj;
}

export function daysUntil(date: string | null): number | null {
  if (!date) return null;
  const target = new Date(date);
  const now = new Date();
  const diff = target.getTime() - now.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}
