import { useState, useEffect, useCallback } from 'react';
import {
  Building2,
  Plus,
  Pencil,
  Trash2,
  X,
  AlertCircle,
} from 'lucide-react';
import type { Unidade } from '@/lib/types';
import {
  fetchUnidades,
  createUnidade,
  updateUnidade,
  deleteUnidade,
} from '@/lib/api';
import { formatCNPJ, deriveCnpjRaiz } from '@/lib/types';

const UFS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA',
  'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN',
  'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
];

interface FormData {
  nome: string;
  cnpj: string;
  uf: string;
  ativo: boolean;
}

const emptyForm: FormData = { nome: '', cnpj: '', uf: 'SP', ativo: true };

export default function UnidadesPage() {
  const [unidades, setUnidades] = useState<Unidade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchUnidades();
      setUnidades(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar unidades');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleOpenCreate = () => {
    setForm(emptyForm);
    setEditingId(null);
    setShowModal(true);
  };

  const handleOpenEdit = (u: Unidade) => {
    setForm({ nome: u.nome, cnpj: u.cnpj, uf: u.uf, ativo: u.ativo });
    setEditingId(u.id);
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cnpjDigits = form.cnpj.replace(/\D/g, '');
    if (cnpjDigits.length !== 14) {
      setError('CNPJ deve ter 14 dígitos');
      return;
    }
    if (!form.nome.trim()) {
      setError('Nome é obrigatório');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (editingId) {
        await updateUnidade(editingId, form.nome, cnpjDigits, form.uf, form.ativo);
      } else {
        await createUnidade(form.nome, cnpjDigits, form.uf);
      }
      setShowModal(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar unidade');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setSaving(true);
    try {
      await deleteUnidade(deleteId);
      setDeleteId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao excluir unidade');
    } finally {
      setSaving(false);
    }
  };

  const formatCnpjInput = (value: string): string => {
    const digits = value.replace(/\D/g, '').substring(0, 14);
    return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  };

  const raizPreview = form.cnpj.replace(/\D/g, '').length >= 8
    ? deriveCnpjRaiz(form.cnpj.replace(/\D/g, ''))
    : '';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-600">
          Cadastre as unidades/filiais da empresa. Todas devem compartilhar a
          mesma raiz de CNPJ (8 primeiros dígitos) do certificado da matriz.
        </p>
        <button
          onClick={handleOpenCreate}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2 flex-shrink-0"
        >
          <Plus className="w-4 h-4" /> Nova Unidade
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-500 text-sm">
            Carregando unidades...
          </div>
        ) : unidades.length === 0 ? (
          <div className="p-12 text-center">
            <Building2 className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500 text-sm">
              Nenhuma unidade cadastrada. Clique em "Nova Unidade" para começar.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-left">
                  <th className="px-4 py-3 font-medium text-slate-600">Nome</th>
                  <th className="px-4 py-3 font-medium text-slate-600">CNPJ</th>
                  <th className="px-4 py-3 font-medium text-slate-600">
                    Raiz CNPJ
                  </th>
                  <th className="px-4 py-3 font-medium text-slate-600">UF</th>
                  <th className="px-4 py-3 font-medium text-slate-600">Status</th>
                  <th className="px-4 py-3 font-medium text-slate-600 text-right">
                    Ações
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {unidades.map((u) => (
                  <tr
                    key={u.id}
                    className="hover:bg-slate-50 transition-colors"
                  >
                    <td className="px-4 py-3 font-medium text-slate-800">
                      {u.nome}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">
                      {formatCNPJ(u.cnpj)}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">
                      {u.cnpj_raiz}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{u.uf}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                          u.ativo
                            ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                            : 'bg-slate-100 text-slate-600 border-slate-200'
                        }`}
                      >
                        {u.ativo ? 'Ativa' : 'Inativa'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleOpenEdit(u)}
                          className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          title="Editar"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setDeleteId(u.id)}
                          className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Excluir"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal: Create/Edit */}
      {showModal && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h3 className="text-base font-semibold text-slate-800">
                {editingId ? 'Editar Unidade' : 'Nova Unidade'}
              </h3>
              <button
                onClick={() => setShowModal(false)}
                className="text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Nome da Unidade
                </label>
                <input
                  type="text"
                  value={form.nome}
                  onChange={(e) =>
                    setForm({ ...form, nome: e.target.value })
                  }
                  placeholder="Ex: Matriz São Paulo"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  CNPJ (14 dígitos)
                </label>
                <input
                  type="text"
                  value={formatCnpjInput(form.cnpj)}
                  onChange={(e) =>
                    setForm({ ...form, cnpj: e.target.value })
                  }
                  placeholder="00.000.000/0000-00"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                />
                {raizPreview && (
                  <p className="text-xs text-slate-500 mt-1">
                    Raiz do CNPJ: <span className="font-mono">{raizPreview}</span>
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  UF
                </label>
                <select
                  value={form.uf}
                  onChange={(e) => setForm({ ...form, uf: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  {UFS.map((uf) => (
                    <option key={uf} value={uf}>
                      {uf}
                    </option>
                  ))}
                </select>
              </div>
              {editingId && (
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.ativo}
                    onChange={(e) =>
                      setForm({ ...form, ativo: e.target.checked })
                    }
                    className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  Unidade ativa
                </label>
              )}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  {saving ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Delete confirmation */}
      {deleteId && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full">
            <div className="px-6 py-5 text-center">
              <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
                <Trash2 className="w-6 h-6 text-red-600" />
              </div>
              <h3 className="text-base font-semibold text-slate-800 mb-1">
                Excluir Unidade
              </h3>
              <p className="text-sm text-slate-500">
                Tem certeza? As notas já baixadas não serão removidas, mas a
                unidade não será mais associada a novas notas.
              </p>
              <div className="flex gap-3 mt-5">
                <button
                  onClick={() => setDeleteId(null)}
                  className="flex-1 px-4 py-2 text-sm font-medium text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleDelete}
                  disabled={saving}
                  className="flex-1 px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
                >
                  {saving ? 'Excluindo...' : 'Excluir'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
