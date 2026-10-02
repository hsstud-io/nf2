import { useState, useEffect, useCallback } from 'react';
import {
  Award,
  Upload,
  Lock,
  CheckCircle2,
  AlertCircle,
  XCircle,
  Calendar,
  Building2,
  FileCheck,
} from 'lucide-react';
import type { Certificado } from '@/lib/types';
import {
  fetchCertificado,
  uploadCertificado,
  parseCertificadoInfo,
} from '@/lib/api';
import { formatCNPJ, formatDate, daysUntil } from '@/lib/types';

interface Props {
  onCertificadoChanged: () => void;
}

export default function CertificadoPage({ onCertificadoChanged }: Props) {
  const [certificado, setCertificado] = useState<Certificado | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [senha, setSenha] = useState('');
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchCertificado();
      setCertificado(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar certificado');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0] ?? null;
    setFile(selected);
    setPreview(null);
    setError(null);
    setSuccess(null);
  };

  const handlePreview = async () => {
    if (!file || !senha) {
      setError('Selecione o arquivo .pfx e informe a senha');
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const info = await parseCertificadoInfo(file, senha);
      setPreview(info);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Erro ao ler certificado. Verifique a senha.',
      );
    } finally {
      setUploading(false);
    }
  };

  const handleUpload = async () => {
    if (!file || !senha) {
      setError('Selecione o arquivo .pfx e informe a senha');
      return;
    }
    setUploading(true);
    setError(null);
    try {
      await uploadCertificado(file, senha);
      setSuccess('Certificado cadastrado com sucesso');
      setFile(null);
      setSenha('');
      setPreview(null);
      await load();
      onCertificadoChanged();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Erro ao cadastrar certificado',
      );
    } finally {
      setUploading(false);
    }
  };

  const certDays = daysUntil(certificado?.validade_fim ?? null);
  const certExpired = certDays !== null && certDays < 0;
  const certWarning = certDays !== null && certDays >= 0 && certDays <= 30;
  const certOk = certDays !== null && certDays > 30;
  const hasCert = certificado?.validade_fim !== null;

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Current certificate status */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
            <Award className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-slate-800">
              Certificado Digital A1
            </h3>
            <p className="text-sm text-slate-500">
              Certificado da matriz — usado para autenticar todas as consultas
            </p>
          </div>
        </div>

        {loading ? (
          <div className="py-8 text-center text-slate-500 text-sm">
            Carregando...
          </div>
        ) : hasCert ? (
          <div className="space-y-4">
            <div
              className={`rounded-lg border p-4 flex items-center gap-3 ${
                certExpired
                  ? 'bg-red-50 border-red-200'
                  : certWarning
                    ? 'bg-amber-50 border-amber-200'
                    : 'bg-emerald-50 border-emerald-200'
              }`}
            >
              {certExpired ? (
                <XCircle className="w-6 h-6 text-red-600 flex-shrink-0" />
              ) : certWarning ? (
                <AlertCircle className="w-6 h-6 text-amber-600 flex-shrink-0" />
              ) : (
                <CheckCircle2 className="w-6 h-6 text-emerald-600 flex-shrink-0" />
              )}
              <div>
                <p
                  className={`text-sm font-medium ${
                    certExpired
                      ? 'text-red-800'
                      : certWarning
                        ? 'text-amber-800'
                        : 'text-emerald-800'
                  }`}
                >
                  {certExpired
                    ? `Certificado vencido há ${Math.abs(certDays!)} dias`
                    : certWarning
                      ? `Certificado vence em ${certDays} dias`
                      : `Certificado válido por mais ${certDays} dias`}
                </p>
                <p className="text-xs text-slate-600 mt-0.5">
                  Vencimento: {formatDate(certificado?.validade_fim ?? null)}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <InfoItem
                icon={Building2}
                label="CNPJ"
                value={
                  certificado?.cnpj
                    ? formatCNPJ(certificado.cnpj)
                    : '—'
                }
              />
              <InfoItem
                icon={FileCheck}
                label="Raiz do CNPJ"
                value={certificado?.cnpj_raiz ?? '—'}
              />
              <InfoItem
                icon={Calendar}
                label="Válido desde"
                value={formatDate(certificado?.validade_inicio ?? null)}
              />
              <InfoItem
                icon={Calendar}
                label="Válido até"
                value={formatDate(certificado?.validade_fim ?? null)}
              />
            </div>

            <div className="pt-2">
              <InfoItem
                icon={Award}
                label="Emissor"
                value={certificado?.emissor ?? '—'}
              />
              <div className="mt-3">
                <InfoItem
                  icon={FileCheck}
                  label="Arquivo"
                  value={certificado?.arquivo_nome ?? '—'}
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="py-8 text-center">
            <Award className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500 text-sm">
              Nenhum certificado cadastrado. Faça upload do arquivo .pfx abaixo.
            </p>
          </div>
        )}
      </div>

      {/* Upload form */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h3 className="text-base font-semibold text-slate-800 mb-1">
          {hasCert ? 'Atualizar Certificado' : 'Cadastrar Certificado'}
        </h3>
        <p className="text-sm text-slate-500 mb-5">
          Selecione o arquivo .pfx (A1) da matriz e informe a senha. O arquivo e
          a senha são armazenados de forma segura e nunca são exibidos.
        </p>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 flex items-center gap-2 mb-4">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {success && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm text-emerald-700 flex items-center gap-2 mb-4">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            {success}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Arquivo .pfx
            </label>
            <div className="flex items-center gap-3">
              <label className="flex-1 px-4 py-2.5 border-2 border-dashed border-slate-300 rounded-lg text-sm text-slate-500 hover:border-blue-400 hover:text-blue-600 cursor-pointer transition-colors text-center">
                <Upload className="w-4 h-4 inline mr-2" />
                {file ? file.name : 'Selecionar arquivo .pfx'}
                <input
                  type="file"
                  accept=".pfx,.p12"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </label>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Senha do certificado
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="password"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                placeholder="••••••••"
                className="w-full pl-10 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          {preview && (
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-2">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
                Pré-visualização
              </p>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-slate-500">CNPJ: </span>
                  <span className="font-mono text-slate-700">
                    {preview.cnpj ? formatCNPJ(preview.cnpj) : '—'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500">Raiz: </span>
                  <span className="font-mono text-slate-700">
                    {preview.cnpj_raiz ?? '—'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500">Válido de: </span>
                  <span className="text-slate-700">
                    {preview.validade_inicio ?? '—'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500">Válido até: </span>
                  <span className="text-slate-700">
                    {preview.validade_fim ?? '—'}
                  </span>
                </div>
                <div className="col-span-2">
                  <span className="text-slate-500">Emissor: </span>
                  <span className="text-slate-700">
                    {preview.emissor ?? '—'}
                  </span>
                </div>
              </div>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              onClick={handlePreview}
              disabled={!file || !senha || uploading}
              className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50"
            >
              {uploading ? 'Processando...' : 'Pré-visualizar'}
            </button>
            <button
              onClick={handleUpload}
              disabled={!file || !senha || uploading}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {uploading ? 'Enviando...' : 'Cadastrar Certificado'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoItem({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Building2;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <Icon className="w-4 h-4 text-slate-400 flex-shrink-0" />
      <div className="min-w-0">
        <p className="text-xs text-slate-500">{label}</p>
        <p className="text-sm text-slate-700 font-medium truncate">{value}</p>
      </div>
    </div>
  );
}
