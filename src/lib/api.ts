import type { Unidade, Nota, SyncControl, Certificado } from './types';
import { deriveCnpjRaiz } from './types';

async function apiGet<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `Erro ${response.status}`);
  }
  return data;
}

async function apiPost<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `Erro ${response.status}`);
  }
  return data;
}

async function apiPut<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `Erro ${response.status}`);
  }
  return data;
}

async function apiDelete(url: string): Promise<void> {
  const response = await fetch(url, { method: 'DELETE' });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Erro ${response.status}`);
  }
}

// ---- Unidades ----

export async function fetchUnidades(): Promise<Unidade[]> {
  return apiGet<Unidade[]>('/notafiscalbaixar/api/unidades');
}

export async function createUnidade(
  nome: string,
  cnpj: string,
  uf: string,
): Promise<Unidade> {
  const cnpjDigits = cnpj.replace(/\D/g, '');
  return apiPost<Unidade>('/notafiscalbaixar/api/unidades', {
    nome,
    cnpj: cnpjDigits,
    cnpj_raiz: deriveCnpjRaiz(cnpjDigits),
    uf,
  });
}

export async function updateUnidade(
  id: string,
  nome: string,
  cnpj: string,
  uf: string,
  ativo: boolean,
): Promise<Unidade> {
  const cnpjDigits = cnpj.replace(/\D/g, '');
  return apiPut<Unidade>(`/notafiscalbaixar/api/unidades/${id}`, {
    nome,
    cnpj: cnpjDigits,
    cnpj_raiz: deriveCnpjRaiz(cnpjDigits),
    uf,
    ativo,
  });
}

export async function deleteUnidade(id: string): Promise<void> {
  await apiDelete(`/notafiscalbaixar/api/unidades/${id}`);
}

// ---- Notas ----

export async function fetchNotas(
  unidadeId?: string,
  dataInicio?: string,
  dataFim?: string,
): Promise<Nota[]> {
  const params = new URLSearchParams();
  if (unidadeId) params.set('unidade_id', unidadeId);
  if (dataInicio) params.set('data_inicio', dataInicio);
  if (dataFim) params.set('data_fim', dataFim);
  const qs = params.toString();
  return apiGet<Nota[]>(`/notafiscalbaixar/api/notas${qs ? `?${qs}` : ''}`);
}

export async function downloadXml(chave: string, _path: string): Promise<void> {
  const response = await fetch(`/notafiscalbaixar/api/notas/${chave}/xml`);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'Erro ao baixar XML');
  }
  const blob = await response.blob();
  triggerDownload(blob, `${chave}.xml`);
}

export async function downloadPdf(chave: string, _path: string): Promise<void> {
  const response = await fetch(`/notafiscalbaixar/api/notas/${chave}/pdf`);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'Erro ao baixar PDF');
  }
  const blob = await response.blob();
  triggerDownload(blob, `${chave}.pdf`);
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---- Sync ----

export async function fetchSyncControl(): Promise<SyncControl | null> {
  return apiGet<SyncControl>('/notafiscalbaixar/api/sync-control');
}

export async function triggerSync(): Promise<any> {
  return apiPost('/notafiscalbaixar/api/sincronizar');
}

// ---- Certificado ----

export async function fetchCertificado(): Promise<Certificado | null> {
  return apiGet<Certificado>('/notafiscalbaixar/api/certificado');
}

export async function uploadCertificado(
  file: File,
  senha: string,
): Promise<any> {
  return apiPost('/notafiscalbaixar/api/certificado', {
    action: 'upload',
    fileName: file.name,
    fileBase64: await fileToBase64(file),
    senha,
  });
}

export async function parseCertificadoInfo(
  file: File,
  senha: string,
): Promise<any> {
  return apiPost('/notafiscalbaixar/api/certificado', {
    action: 'parse',
    fileName: file.name,
    fileBase64: await fileToBase64(file),
    senha,
  });
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
