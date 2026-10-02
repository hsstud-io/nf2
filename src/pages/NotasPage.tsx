import { useState, useEffect, useCallback } from 'react';
import {
  FileText,
  FileDown,
  Download,
  Search,
  Filter,
  Building2,
  Calendar,
  Inbox,
} from 'lucide-react';
import type { Unidade, Nota } from '@/lib/types';
import {
  fetchUnidades,
  fetchNotas,
  downloadXml,
  downloadPdf,
} from '@/lib/api';
import {
  statusLabel,
  statusColor,
  formatCNPJ,
  formatCurrency,
  formatDate,
} from '@/lib/types';

const UFS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA',
  'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN',
  'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
];

export default function NotasPage() {
  const [notas, setNotas] = useState<Nota[]>([]);
  const [unidades, setUnidades] = useState<Unidade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unidadeFilter, setUnidadeFilter] = useState('');
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [u, n] = await Promise.all([
        fetchUnidades(),
        fetchNotas(
          unidadeFilter || undefined,
          dataInicio || undefined,
          dataFim || undefined,
        ),
      ]);
      setUnidades(u);
      setNotas(n);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar notas');
    } finally {
      setLoading(false);
    }
  }, [unidadeFilter, dataInicio, dataFim]);

  useEffect(() => {
    load();
  }, [load]);

  const unidadeMap = new Map(unidades.map((u) => [u.id, u]));

  const handleDownloadXml = async (nota: Nota) => {
    if (!nota.xml_path) return;
    setDownloadingKey(`${nota.chave_acesso}-xml`);
    try {
      await downloadXml(nota.chave_acesso, nota.xml_path);
    } catch {
      setError('Erro ao baixar XML');
    } finally {
      setDownloadingKey(null);
    }
  };

  const handleDownloadPdf = async (nota: Nota) => {
    if (!nota.pdf_path) return;
    setDownloadingKey(`${nota.chave_acesso}-pdf`);
    try {
      await downloadPdf(nota.chave_acesso, nota.pdf_path);
    } catch {
      setError('Erro ao baixar PDF');
    } finally {
      setDownloadingKey(null);
    }
  };

  const totalNotas = notas.length;
  const totalBaixadas = notas.filter((n) => n.status === 'baixada').length;
  const totalPendentes = notas.filter((n) => n.status === 'pendente').length;
  const totalValor = notas.reduce((sum, n) => sum + (n.valor_total ?? 0), 0);

  return (
    <div className="space-y-6">
      {/* Stats cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard
          label="Total de Notas"
          value={totalNotas.toString()}
          icon={FileText}
          color="blue"
        />
        <StatCard
          label="Baixadas"
          value={totalBaixadas.toString()}
          icon={FileDown}
          color="emerald"
        />
        <StatCard
          label="Pendentes"
          value={totalPendentes.toString()}
          icon={Inbox}
          color="amber"
        />
        <StatCard
          label="Valor Total"
          value={formatCurrency(totalValor)}
          icon={Calendar}
          color="slate"
        />
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-slate-600 flex items-center gap-1.5">
              <Filter className="w-3.5 h-3.5" /> Unidade
            </label>
            <select
              value={unidadeFilter}
              onChange={(e) => setUnidadeFilter(e.target.value)}
              className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent min-w-[200px]"
            >
              <option value="">Todas as unidades</option>
              {unidades.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nome} — {formatCNPJ(u.cnpj)}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-slate-600">
              Data Início
            </label>
            <input
              type="date"
              value={dataInicio}
              onChange={(e) => setDataInicio(e.target.value)}
              className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-slate-600">
              Data Fim
            </label>
            <input
              type="date"
              value={dataFim}
              onChange={(e) => setDataFim(e.target.value)}
              className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <button
            onClick={load}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
          >
            <Search className="w-4 h-4" /> Filtrar
          </button>

          {(unidadeFilter || dataInicio || dataFim) && (
            <button
              onClick={() => {
                setUnidadeFilter('');
                setDataInicio('');
                setDataFim('');
              }}
              className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 transition-colors"
            >
              Limpar
            </button>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-500 text-sm">
            Carregando notas...
          </div>
        ) : notas.length === 0 ? (
          <div className="p-12 text-center">
            <Inbox className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500 text-sm">
              Nenhuma nota encontrada. Execute uma sincronização para baixar
              documentos da Sefaz.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-left">
                  <th className="px-4 py-3 font-medium text-slate-600">
                    Chave de Acesso
                  </th>
                  <th className="px-4 py-3 font-medium text-slate-600">
                    Unidade
                  </th>
                  <th className="px-4 py-3 font-medium text-slate-600">
                    CNPJ
                  </th>
                  <th className="px-4 py-3 font-medium text-slate-600">
                    Emissão
                  </th>
                  <th className="px-4 py-3 font-medium text-slate-600 text-right">
                    Valor
                  </th>
                  <th className="px-4 py-3 font-medium text-slate-600">
                    Status
                  </th>
                  <th className="px-4 py-3 font-medium text-slate-600 text-right">
                    Ações
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {notas.map((nota) => {
                  const unidade = nota.unidade_id
                    ? unidadeMap.get(nota.unidade_id)
                    : null;
                  return (
                    <tr
                      key={nota.id}
                      className="hover:bg-slate-50 transition-colors"
                    >
                      <td className="px-4 py-3 font-mono text-xs text-slate-700">
                        {nota.chave_acesso}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        <div className="flex items-center gap-2">
                          <Building2 className="w-3.5 h-3.5 text-slate-400" />
                          {unidade?.nome ?? '—'}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-600 font-mono text-xs">
                        {nota.cnpj_unidade
                          ? formatCNPJ(nota.cnpj_unidade)
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {formatDate(nota.data_emissao)}
                      </td>
                      <td className="px-4 py-3 text-slate-700 text-right font-medium">
                        {formatCurrency(nota.valor_total)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${statusColor(
                            nota.status,
                          )}`}
                        >
                          {statusLabel(nota.status)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleDownloadXml(nota)}
                            disabled={!nota.xml_path}
                            className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                            title="Baixar XML"
                          >
                            {downloadingKey ===
                            `${nota.chave_acesso}-xml` ? (
                              <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                            ) : (
                              <Download className="w-4 h-4" />
                            )}
                          </button>
                          <button
                            onClick={() => handleDownloadPdf(nota)}
                            disabled={!nota.pdf_path}
                            className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                            title="Baixar PDF"
                          >
                            {downloadingKey ===
                            `${nota.chave_acesso}-pdf` ? (
                              <div className="w-4 h-4 border-2 border-red-600 border-t-transparent rounded-full animate-spin" />
                            ) : (
                              <FileDown className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: string;
  icon: typeof FileText;
  color: 'blue' | 'emerald' | 'amber' | 'slate';
}) {
  const colorClasses = {
    blue: 'bg-blue-50 text-blue-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    slate: 'bg-slate-100 text-slate-600',
  };
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-4">
      <div
        className={`w-11 h-11 rounded-lg flex items-center justify-center flex-shrink-0 ${colorClasses[color]}`}
      >
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-slate-500 font-medium">{label}</p>
        <p className="text-lg font-semibold text-slate-800 truncate">{value}</p>
      </div>
    </div>
  );
}
