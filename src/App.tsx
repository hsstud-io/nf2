import { useState, useEffect, useCallback } from 'react';
import {
  FileText,
  Building2,
  Award,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Clock,
} from 'lucide-react';
import type { SyncControl, Certificado } from '@/lib/types';
import { daysUntil, formatDateTime } from '@/lib/types';
import { fetchSyncControl, fetchCertificado } from '@/lib/api';
import NotasPage from '@/pages/NotasPage';
import UnidadesPage from '@/pages/UnidadesPage';
import CertificadoPage from '@/pages/CertificadoPage';
import SincronizacaoPage from '@/pages/SincronizacaoPage';

type Page = 'notas' | 'unidades' | 'certificado' | 'sincronizacao';

const NAV_ITEMS: { id: Page; label: string; icon: typeof FileText }[] = [
  { id: 'notas', label: 'Notas Fiscais', icon: FileText },
  { id: 'unidades', label: 'Unidades', icon: Building2 },
  { id: 'certificado', label: 'Certificado', icon: Award },
  { id: 'sincronizacao', label: 'Sincronização', icon: RefreshCw },
];

export default function App() {
  const [page, setPage] = useState<Page>('notas');
  const [syncControl, setSyncControl] = useState<SyncControl | null>(null);
  const [certificado, setCertificado] = useState<Certificado | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const loadStatus = useCallback(async () => {
    try {
      const [sync, cert] = await Promise.all([
        fetchSyncControl(),
        fetchCertificado(),
      ]);
      setSyncControl(sync);
      setCertificado(cert);
    } catch {
      // silently ignore — status bar will show defaults
    }
  }, []);

  useEffect(() => {
    loadStatus();
    const interval = setInterval(loadStatus, 30000);
    return () => clearInterval(interval);
  }, [loadStatus, refreshKey]);

  const refreshStatus = () => setRefreshKey((k) => k + 1);

  const certDays = daysUntil(certificado?.validade_fim ?? null);
  const certExpired = certDays !== null && certDays < 0;
  const certWarning = certDays !== null && certDays >= 0 && certDays <= 30;
  const certOk = certDays !== null && certDays > 30;

  const syncOk = syncControl?.status_ultima_execucao === 'sucesso';
  const syncError = syncControl?.status_ultima_execucao === 'erro';
  const syncRunning = syncControl?.status_ultima_execucao === 'em_andamento';

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900 text-slate-100 flex flex-col fixed h-full z-20">
        <div className="px-6 py-5 border-b border-slate-700/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-600 flex items-center justify-center flex-shrink-0">
              <FileText className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="text-sm font-semibold text-white truncate">
                NFe Distribuição
              </h1>
              <p className="text-xs text-slate-400 truncate">DFe Manager</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = page === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setPage(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  active
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="px-4 py-4 border-t border-slate-700/50 space-y-3">
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">
              Certificado
            </p>
            {certificado?.validade_fim ? (
              <div className="flex items-center gap-2">
                {certExpired ? (
                  <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                ) : certWarning ? (
                  <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                )}
                <span
                  className={`text-xs ${
                    certExpired
                      ? 'text-red-400'
                      : certWarning
                        ? 'text-amber-400'
                        : 'text-emerald-400'
                  }`}
                >
                  {certExpired
                    ? `Vencido há ${Math.abs(certDays!)} dias`
                    : certWarning
                      ? `Vence em ${certDays} dias`
                      : `${certDays} dias restantes`}
                </span>
              </div>
            ) : (
              <span className="text-xs text-slate-500">Não cadastrado</span>
            )}
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">
              Última Sincronização
            </p>
            <div className="flex items-center gap-2">
              {syncRunning ? (
                <Clock className="w-4 h-4 text-blue-400 flex-shrink-0 animate-spin" />
              ) : syncOk ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              ) : syncError ? (
                <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
              ) : (
                <Clock className="w-4 h-4 text-slate-500 flex-shrink-0" />
              )}
              <span className="text-xs text-slate-300">
                {syncControl?.ultima_execucao
                  ? formatDateTime(syncControl.ultima_execucao)
                  : 'Nunca executada'}
              </span>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 ml-64 flex flex-col min-h-screen">
        {/* Top bar */}
        <header className="bg-white border-b border-slate-200 px-8 py-4 sticky top-0 z-10">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-800">
              {NAV_ITEMS.find((n) => n.id === page)?.label}
            </h2>
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-2">
                {certExpired ? (
                  <span className="flex items-center gap-1.5 text-red-600">
                    <AlertCircle className="w-4 h-4" />
                    Certificado vencido
                  </span>
                ) : certWarning ? (
                  <span className="flex items-center gap-1.5 text-amber-600">
                    <AlertCircle className="w-4 h-4" />
                    Certificado expira em {certDays} dias
                  </span>
                ) : certOk ? (
                  <span className="flex items-center gap-1.5 text-emerald-600">
                    <CheckCircle2 className="w-4 h-4" />
                    Certificado válido
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 p-8">
          {page === 'notas' && <NotasPage key={`notas-${refreshKey}`} />}
          {page === 'unidades' && (
            <UnidadesPage key={`unidades-${refreshKey}`} />
          )}
          {page === 'certificado' && (
            <CertificadoPage
              key={`cert-${refreshKey}`}
              onCertificadoChanged={refreshStatus}
            />
          )}
          {page === 'sincronizacao' && (
            <SincronizacaoPage
              key={`sync-${refreshKey}`}
              onSyncCompleted={refreshStatus}
            />
          )}
        </main>
      </div>
    </div>
  );
}
