import { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  Activity,
  Calendar,
  Hash,
  Loader2,
  Play,
} from 'lucide-react';
import type { SyncControl, Certificado } from '@/lib/types';
import {
  fetchSyncControl,
  fetchCertificado,
  triggerSync,
} from '@/lib/api';
import { formatDateTime, daysUntil } from '@/lib/types';

interface Props {
  onSyncCompleted: () => void;
}

export default function SincronizacaoPage({ onSyncCompleted }: Props) {
  const [syncControl, setSyncControl] = useState<SyncControl | null>(null);
  const [certificado, setCertificado] = useState<Certificado | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sync, cert] = await Promise.all([
        fetchSyncControl(),
        fetchCertificado(),
      ]);
      setSyncControl(sync);
      setCertificado(cert);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Erro ao carregar status',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleSyncNow = async () => {
    setSyncing(true);
    setError(null);
    setSyncResult(null);
    try {
      const result = await triggerSync();
      setSyncResult(result);
      await load();
      onSyncCompleted();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Erro ao executar sincronização',
      );
    } finally {
      setSyncing(false);
    }
  };

  const certDays = daysUntil(certificado?.validade_fim ?? null);
  const syncOk = syncControl?.status_ultima_execucao === 'sucesso';
  const syncErrorStatus = syncControl?.status_ultima_execucao === 'erro';

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Action card */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
              <RefreshCw className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-800">
                Sincronização com Sefaz
              </h3>
              <p className="text-sm text-slate-500 mt-0.5 max-w-md">
                Executa a consulta NFeDistribuicaoDFe, envia manifestação de
                ciência da operação para notas pendentes, baixa o XML completo e
                gera o DANFE em PDF.
              </p>
            </div>
          </div>
          <button
            onClick={handleSyncNow}
            disabled={syncing}
            className="px-5 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2 flex-shrink-0 disabled:opacity-50"
          >
            {syncing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Sincronizando...
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                Sincronizar Agora
              </>
            )}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700 flex items-center gap-2">
          <XCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Sync result */}
      {syncResult && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 text-sm text-emerald-700">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            <span className="font-medium">Sincronização concluída</span>
          </div>
          <div className="text-xs space-y-1 text-emerald-600">
            <p>
              Documentos encontrados: {syncResult.documentosEncontrados ?? 0}
            </p>
            <p>
              Notas manifestadas: {syncResult.notasManifestadas ?? 0}
            </p>
            <p>
              XMLs baixados: {syncResult.xmlsBaixados ?? 0}
            </p>
            <p>
              DANFEs gerados: {syncResult.danfesGerados ?? 0}
            </p>
            {syncResult.mensagem && (
              <p className="mt-2 text-emerald-700">{syncResult.mensagem}</p>
            )}
          </div>
        </div>
      )}

      {/* Status cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Last execution */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Activity className="w-4 h-4 text-slate-400" />
            <h4 className="text-sm font-semibold text-slate-700">
              Última Execução
            </h4>
          </div>
          {loading ? (
            <p className="text-sm text-slate-400">Carregando...</p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                {syncOk ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                ) : syncErrorStatus ? (
                  <XCircle className="w-5 h-5 text-red-500" />
                ) : (
                  <Clock className="w-5 h-5 text-slate-400" />
                )}
                <span
                  className={`text-sm font-medium ${
                    syncOk
                      ? 'text-emerald-700'
                      : syncErrorStatus
                        ? 'text-red-700'
                        : 'text-slate-500'
                  }`}
                >
                  {syncControl?.status_ultima_execucao === 'sucesso'
                    ? 'Sucesso'
                    : syncControl?.status_ultima_execucao === 'erro'
                      ? 'Erro'
                      : syncControl?.status_ultima_execucao === 'em_andamento'
                        ? 'Em andamento'
                        : 'Nunca executada'}
                </span>
              </div>
              <InfoRow
                icon={Calendar}
                label="Data/Hora"
                value={
                  syncControl?.ultima_execucao
                    ? formatDateTime(syncControl.ultima_execucao)
                    : '—'
                }
              />
              <InfoRow
                icon={Activity}
                label="Documentos processados"
                value={(
                  syncControl?.documentos_processados ?? 0
                ).toString()}
              />
              {syncControl?.mensagem && (
                <p className="text-xs text-slate-500 bg-slate-50 rounded-lg p-2 mt-2">
                  {syncControl.mensagem}
                </p>
              )}
            </div>
          )}
        </div>

        {/* NSU tracking */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Hash className="w-4 h-4 text-slate-400" />
            <h4 className="text-sm font-semibold text-slate-700">
              Controle de NSU
            </h4>
          </div>
          {loading ? (
            <p className="text-sm text-slate-400">Carregando...</p>
          ) : (
            <div className="space-y-3">
              <InfoRow
                icon={Hash}
                label="Último NSU processado"
                value={(syncControl?.ult_nsu ?? 0).toString()}
              />
              <InfoRow
                icon={Hash}
                label="NSU máximo"
                value={(syncControl?.max_nsu ?? 0).toString()}
              />
              <div className="mt-3">
                <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                  <span>Progresso</span>
                  <span>
                    {syncControl?.ult_nsu ?? 0} /{' '}
                    {syncControl?.max_nsu ?? 0}
                  </span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-600 rounded-full transition-all"
                    style={{
                      width: `${Math.min(
                        100,
                        ((syncControl?.ult_nsu ?? 0) /
                          Math.max(1, syncControl?.max_nsu ?? 1)) *
                          100,
                      )}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Certificate status */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center gap-2 mb-4">
            <CheckCircle2 className="w-4 h-4 text-slate-400" />
            <h4 className="text-sm font-semibold text-slate-700">
              Status do Certificado
            </h4>
          </div>
          {loading ? (
            <p className="text-sm text-slate-400">Carregando...</p>
          ) : certificado?.validade_fim ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                {certDays !== null && certDays < 0 ? (
                  <XCircle className="w-5 h-5 text-red-500" />
                ) : certDays !== null && certDays <= 30 ? (
                  <Clock className="w-5 h-5 text-amber-500" />
                ) : (
                  <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                )}
                <span
                  className={`text-sm font-medium ${
                    certDays !== null && certDays < 0
                      ? 'text-red-700'
                      : certDays !== null && certDays <= 30
                        ? 'text-amber-700'
                        : 'text-emerald-700'
                  }`}
                >
                  {certDays !== null && certDays < 0
                    ? `Vencido há ${Math.abs(certDays)} dias`
                    : certDays !== null && certDays <= 30
                      ? `Vence em ${certDays} dias`
                      : `${certDays} dias restantes`}
                </span>
              </div>
              <InfoRow
                icon={Calendar}
                label="Vencimento"
                value={formatDateTime(certificado.validade_fim)}
              />
            </div>
          ) : (
            <p className="text-sm text-slate-400">
              Nenhum certificado cadastrado
            </p>
          )}
        </div>

        {/* Schedule info */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Clock className="w-4 h-4 text-slate-400" />
            <h4 className="text-sm font-semibold text-slate-700">
              Agendamento
            </h4>
          </div>
          <div className="space-y-3">
            <InfoRow
              icon={Clock}
              label="Intervalo"
              value="A cada 2 horas"
            />
            <InfoRow
              icon={Activity}
              label="Modo"
              value="Automático + Manual"
            />
            <p className="text-xs text-slate-500 bg-slate-50 rounded-lg p-2">
              A sincronização automática executa a cada 2 horas. Você também
              pode executar manualmente a qualquer momento usando o botão
              "Sincronizar Agora".
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Calendar;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <Icon className="w-4 h-4 text-slate-400 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="text-xs text-slate-500">{label}: </span>
        <span className="text-sm text-slate-700 font-medium">{value}</span>
      </div>
    </div>
  );
}
